import { authenticatedFetch } from './request';
import { clampArticleCount, DEFAULT_ARTICLES } from './config';
import { normalizeDisease, normalizeEvents } from './caseValidation';
// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// src/utils/api.js

export const retrieveAndAnalyzeArticles = async (disease, events, specialtyId, onProgress, numArticles = DEFAULT_ARTICLES, weightOverrides) => {
  const failure = () => new Error('Literature retrieval could not be completed. Please try again.');
  let response;
  try {
    response = await authenticatedFetch(process.env.REACT_APP_RETRIEVE_ARTICLES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events_text: events.join('\n'), specialtyId, disease,
        num_articles: clampArticleCount(numArticles), weightOverrides })
    });
  } catch { throw failure(); }
  if (!response.ok || !response.body) throw failure();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  const processLine = async line => {
    if (!line.trim()) return;
    let data;
    try { data = JSON.parse(line); } catch { throw failure(); }
    if (!data || typeof data !== 'object' || !data.type || data.type === 'error' || complete) throw failure();
    // Callback failures belong to the workflow, not the JSON parser.
    await onProgress(data);
    if (data.type === 'metadata' && data.data?.status === 'complete') complete = true;
  };
  try {
    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch { throw failure(); }
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let lineEnd;
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        await processLine(line);
      }
      if (chunk.done) break;
    }
    await processLine(buffer);
    if (!complete) throw failure();
  } finally {
    reader.releaseLock?.();
  }
};

const templatesUrl = () => process.env.REACT_APP_TEMPLATES_URL;

export const streamChat = async (message, userId, chatId, onChunk, specialtyId) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        userId,
        chatId,
        specialtyId
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            break;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              onChunk(parsed.text);
            }
          } catch (e) {

          }
        }
      }
    }
  } catch (error) {

    throw error;
  }
};
const GENERATE_CASE_URL = process.env.REACT_APP_GENERATE_CASE_URL;

/**
 * Redacts sensitive information from text while preserving medical terms, age, and gender
 * @param {string} text - The text to redact
 * @returns {Promise<string>} - A promise that resolves to the redacted text
 */
export const redactSensitiveInfo = async (text) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_REDACT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.redactedText;
  } catch (error) {

    throw new Error(`Failed to redact sensitive information: ${error.message}`);
  }
};

// Detects which specialty persona should analyze this case, before any
// specialty-driven extraction runs. See docs/auto-specialty-detection-plan.md
// at the repo root.
export const detectSpecialty = async (text) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_DETECT_SPECIALTY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const detected = await response.json();
    if(detected?.isClinicalCase !== true || !detected.specialtyId) throw new Error('No clinical case was identified.');
    return detected;
  } catch (error) {

    throw error;
  }
};

export const extractDisease = async (text, specialtyId) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_EXTRACT_DISEASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, specialtyId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.text();
    return normalizeDisease(parseClinicalResponse(data));
  } catch (error) {

    throw error;
  }
};

export const extractEvents = async (text, specialtyId) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_EXTRACT_EVENTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, specialtyId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.text();
    return normalizeEvents(data);
  } catch (error) {

    throw error;
  }
};

/**
 * Generates a sample medical case
 * @returns {Promise<string>} - A promise that resolves to a generated sample medical case
 */
export const generateSampleCase = async () => {
  try {
    const response = await authenticatedFetch(GENERATE_CASE_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.medical_case;
  } catch (error) {

    throw new Error(`Failed to generate sample case: ${error.message}`);
  }
};

/**
 * Saves a new template or updates an existing one
 * @param {Object} template - The template object to save
 * @returns {Promise<Object>} - A promise that resolves to the saved template object
 */
export const saveTemplate = async (template) => {
  try {
    const response = await authenticatedFetch(templatesUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(template),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.template;
  } catch (error) {

    throw new Error(`Failed to save template: ${error.message}`);
  }
};

/**
 * Fetches all saved templates
 * @returns {Promise<Array>} - A promise that resolves to an array of template objects
 */
export const fetchTemplates = async () => {
  try {
    const response = await authenticatedFetch(templatesUrl(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.templates;
  } catch (error) {

    throw new Error(`Failed to fetch templates: ${error.message}`);
  }
};

/**
 * Deletes a template
 * @param {string} templateId - The ID of the template to delete
 * @returns {Promise<void>}
 */
export const deleteTemplate = async (templateId) => {
  try {
    const response = await authenticatedFetch(templatesUrl() ? `${templatesUrl()}/${encodeURIComponent(templateId)}` : undefined, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }
  } catch (error) {

    throw new Error(`Failed to delete template: ${error.message}`);
  }
};

/**
 * Generates a final analysis based on case notes, disease, events, and analyzed articles
 * @param {string} caseNotes - The patient's case notes
 * @param {string} disease - The extracted disease
 * @param {Array} events - The extracted actionable events
 * @param {Array} analyzedArticles - The analyzed articles with their metadata
 * @returns {Promise<Object>} - A promise that resolves to the final analysis object
 */
export const generateFinalAnalysis = async (caseNotes, disease, events, analyzedArticles, specialtyId) => {
  try {


    const response = await authenticatedFetch(process.env.REACT_APP_FINAL_ANALYSIS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        case_notes: caseNotes,
        disease,
        events,
        analyzed_articles: analyzedArticles,
        specialtyId
      })
    });

    if (!response.ok) {

      throw new Error( `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success === false || typeof data.analysis?.markdown_content !== 'string' || !data.analysis.markdown_content.trim()) {
      throw new Error('Invalid final analysis');
    }
    return data.analysis;
  } catch (error) {

    throw new Error('Final analysis could not be completed. Please try again.');
  }
};

/**
 * Sends user feedback to the feedback endpoint
 * @param {Object} feedbackData - The feedback data object containing name, email, and feedback
 * @returns {Promise<Object>} - A promise that resolves to the response object
 */
export const sendFeedback = async (feedbackData) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_FEEDBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(feedbackData),
    });

    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {

    throw new Error(`Failed to send feedback: ${error.message}`);
  }
};

/**
 * Processes a PDF lab report to extract genomic information
 * @param {string} pdfBase64 - The base64 encoded PDF content
 * @returns {Promise<Object>} - A promise that resolves to the extracted genomic data
 */
export const processLabPDF = async (pdfBase64) => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_PROCESS_LAB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pdf_data: pdfBase64 }),
    });

    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      return result.data;
    } else {
      throw new Error( 'Failed to process PDF');
    }
  } catch (error) {

    throw new Error(`Failed to process lab PDF: ${error.message}`);
  }
};

/**
 * Analyzes a medical thoracic image (DICOM, CXR, CT) using Gemini Multimodal Vision.
 * Windowing and normalizations are handled on the backend.
 *
 * @param {string} imageBase64 - Base64 encoded image or DICOM data
 * @param {string} fileName - Original file name (e.g. scan.dcm, cxr.png)
 * @param {string} specialtyId - Specialty ID (defaults to 'tuberculosis')
 * @returns {Promise<Object>} - Analysis result with structured findings, report text, and events
 */
export const analyzeMedicalImage = async (imageBase64, fileName = '', specialtyId = 'tuberculosis') => {
  try {
    const response = await authenticatedFetch(process.env.REACT_APP_ANALYZE_IMAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_data: imageBase64,
        file_name: fileName,
        specialty_id: specialtyId,
      }),
    });

    if (!response.ok) {
      throw new Error( `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      return result.data;
    } else {
      throw new Error( 'Failed to analyze medical image');
    }
  } catch (error) {

    throw new Error(`Failed to analyze medical image: ${error.message}`);
  }
};


const parseClinicalResponse = text => { try { return JSON.parse(text); } catch { return text; } };
