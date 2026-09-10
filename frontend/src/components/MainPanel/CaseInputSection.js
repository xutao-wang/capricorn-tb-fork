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

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { redactSensitiveInfo, processLabPDF, analyzeMedicalImage } from '../../utils/api';
import LoadingSpinner from '../LoadingSpinner';
import {
  presetCaseNotes,
  presetLabResults,
  presetTBCaseNotes,
  presetTBLabResults,
  presetTBFindings
} from '../../data/presetData';
import { Mic, MicOff, AlertTriangle, ArrowRight, Upload, FileImage, Sparkles, ChevronDown } from 'lucide-react';
import useDebounce from '../../hooks/useDebounce';
import LabInputModal from '../Modal/LabInputModal';
import ImageInputModal from '../Modal/ImageInputModal';
import RadiologyFindingsCard from './RadiologyFindingsCard';

// Define the SpeechRecognition interface
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const CaseInputSection = ({
  caseNotes,
  setCaseNotes,
  labResults,
  setLabResults,
  isProcessing,
  handleExtract,
  handleExampleLoad,
  showCaseInput,
  handleClearAll,
  numArticles,
  setNumArticles
}) => {
  const [isRedacting, setIsRedacting] = useState(false);
  const [showLabResults, setShowLabResults] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const [error, setError] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [focusedInput, setFocusedInput] = useState('caseNotes');
  const [localCaseNotes, setLocalCaseNotes] = useState('');
  const [localLabResults, setLocalLabResults] = useState('');
  const [isProcessingPDF, setIsProcessingPDF] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');
  const [showLabInputChoiceModal, setShowLabInputChoiceModal] = useState(false);

  // Multimodal Medical Imaging States
  const [showImageModal, setShowImageModal] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageFindings, setImageFindings] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [imageFileName, setImageFileName] = useState('');
  const [showExampleMenu, setShowExampleMenu] = useState(false);

  const caseNotesRef = useRef(null);
  const labResultsRef = useRef(null);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const debouncedCaseNotes = useDebounce(localCaseNotes, 2000);
  const debouncedLabResults = useDebounce(localLabResults, 2000);

  useEffect(() => {
    const hasInputNow = localCaseNotes.trim().length > 0;
    setHasInput(hasInputNow);
  }, [localCaseNotes]);

  useEffect(() => {
    setLocalCaseNotes(caseNotes || '');
    setLocalLabResults(labResults || '');
  }, [caseNotes, labResults]);

  useEffect(() => {
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        let currentInterimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            currentInterimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          console.log('SPEECH_DEBUG: Microphone finished transcribing');
          if (focusedInput === 'caseNotes') {
            setCaseNotes(prevNotes => {
              const newNotes = (prevNotes.trim() === '' ? finalTranscript : prevNotes + ' ' + finalTranscript).trim();
              console.log('SPEECH_DEBUG: Text added to case notes');
              setLocalCaseNotes(newNotes);
              return newNotes;
            });
          } else {
            setLabResults(prevResults => {
              const newResults = (prevResults.trim() === '' ? finalTranscript : prevResults + ' ' + finalTranscript).trim();
              console.log('SPEECH_DEBUG: Text added to lab results');
              setLocalLabResults(newResults);
              return newResults;
            });
          }
          setHasInput(true);
        }
        setInterimTranscript(currentInterimTranscript);
      };

      recognitionRef.current.onerror = (event) => {
        setError(`Speech recognition error: ${event.error}`);
        setIsListening(false);
        console.log('SPEECH_DEBUG: Speech recognition error occurred');
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        setInterimTranscript('');
        console.log('SPEECH_DEBUG: Speech recognition ended');
        console.log('SPEECH_DEBUG: Starting redaction');
        handleRedaction(localCaseNotes, setCaseNotes);
      };
    } else {
      setError('Speech Recognition API is not supported in this browser.');
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const handleRedaction = useCallback(
    async (text, setter) => {
      if (!text.trim()) return text;
      
      try {
        setIsRedacting(true);
        console.log('SPEECH_DEBUG: Sending text for redaction:', text);
        const redactedText = await redactSensitiveInfo(text);
        console.log('SPEECH_DEBUG: Received redacted text:', redactedText);
        setter(redactedText);
        console.log('SPEECH_DEBUG: Redaction completed and set');
        return redactedText;
      } catch (error) {
        console.error('SPEECH_DEBUG: Redaction failed:', error);
        return text; // Return original text on error
      } finally {
        setIsRedacting(false);
      }
    },
    []
  );

  useEffect(() => {
    handleRedaction(debouncedCaseNotes, setCaseNotes);
  }, [debouncedCaseNotes, handleRedaction, setCaseNotes]);

  useEffect(() => {
    handleRedaction(debouncedLabResults, setLabResults);
  }, [debouncedLabResults, handleRedaction, setLabResults]);

  const handleCaseNotesChange = (e) => {
    const newText = e.target.value;
    setLocalCaseNotes(newText);
    setCaseNotes(newText);
    setHasInput(newText.trim().length > 0);
  };

  const handleCaseNotesFocus = () => {
    setFocusedInput('caseNotes');
  };

  const handleCaseNotesBlur = () => {
    if (!labResultsRef.current || !labResultsRef.current.contains(document.activeElement)) {
      setFocusedInput(null);
    }
  };

  const handleButtonClick = useCallback(async () => {
    if (!recognitionRef.current) return;

    if (!isListening) {
      if (!hasInput) {
        setError(null); // Clear any previous errors
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch (error) {
          setError(`Failed to start recognition: ${error.message}`);
          setIsListening(false);
        }
      } else if (!isProcessing) {
        // Force immediate redaction before extraction
        setIsRedacting(true);
        
        try {
          // Redact both case notes and lab results
          const redactedCaseNotes = await handleRedaction(localCaseNotes, setCaseNotes);
          let redactedLabResults = localLabResults;
          
          if (localLabResults.trim()) {
            redactedLabResults = await handleRedaction(localLabResults, setLabResults);
          }
          
          // Ensure state is updated with redacted values before extraction
          // Use a small timeout to ensure React state updates have propagated
          setTimeout(() => {
            // Now proceed with extraction using the redacted values
            handleExtract();
          }, 0);
          
        } catch (error) {
          console.error('Error during forced redaction:', error);
          setError('Failed to redact sensitive information. Please try again.');
          // Do NOT proceed with extraction if redaction fails
        }
      }
    } else {
      recognitionRef.current.stop();
      setIsListening(false);
      console.log('SPEECH_DEBUG: Manually stopped recording');
    }
  }, [isListening, hasInput, isProcessing, handleExtract, localCaseNotes, localLabResults, handleRedaction]);

  const handleLabResultsChange = (e) => {
    const newText = e.target.value;
    setLocalLabResults(newText);
    setLabResults(newText);
  };

  const handleLabResultsFocus = () => {
    setFocusedInput('labResults');
  };

  const handleLabResultsBlur = () => {
    if (!caseNotesRef.current || !caseNotesRef.current.contains(document.activeElement)) {
      setFocusedInput(null);
    }
  };

  const calculateMaxHeight = () => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Get footer height (approximately 72px based on py-4 and content)
    const footerHeight = 72;
    
    // Get the position of the CaseInputSection
    const containerElement = document.querySelector('.case-input-container');
    const containerTop = containerElement ? containerElement.getBoundingClientRect().top : 200;
    
    // Calculate available space (viewport height - container top - footer - safety margin)
    const safetyMargin = 40; // Extra margin to ensure no overlap
    const availableHeight = viewportHeight - containerTop - footerHeight - safetyMargin;
    
    // Apply responsive constraints
    let maxHeightRatio;
    if (viewportWidth < 640) {
      // Mobile: more restrictive to prevent footer overlap
      maxHeightRatio = 0.25; // 25% of viewport
    } else if (viewportWidth < 1024) {
      // Tablet
      maxHeightRatio = 0.35; // 35% of viewport
    } else {
      // Desktop
      maxHeightRatio = 0.45; // 45% of viewport
    }
    
    // Return the smaller of the two constraints
    return Math.min(availableHeight * 0.7, viewportHeight * maxHeightRatio);
  };

  const calculateContainerMaxHeight = () => {
    const viewportHeight = window.innerHeight;
    const footerHeight = 72;
    const containerElement = document.querySelector('.case-input-container');
    const containerTop = containerElement ? containerElement.getBoundingClientRect().top : 200;
    
    // Calculate max height for the entire container
    const safetyMargin = 40;
    const maxContainerHeight = viewportHeight - containerTop - footerHeight - safetyMargin;
    
    // Cap at 75vh as a maximum
    return Math.min(maxContainerHeight, viewportHeight * 0.75);
  };

  const adjustTextareaHeight = (textarea) => {
    if (!textarea) return;
    
    textarea.style.height = 'auto';
    const newHeight = textarea.scrollHeight + 4;
    const maxHeight = calculateMaxHeight();
    
    if (newHeight <= maxHeight) {
      textarea.style.height = newHeight + 'px';
      textarea.style.overflowY = 'hidden';
    } else {
      textarea.style.height = maxHeight + 'px';
      textarea.style.overflowY = 'auto';
    }
  };

  const adjustAllTextareas = () => {
    // When both textareas are visible, split the available height
    if (showLabResults && caseNotesRef.current && labResultsRef.current) {
      const maxTotalHeight = calculateMaxHeight();
      
      // Calculate natural heights
      caseNotesRef.current.style.height = 'auto';
      labResultsRef.current.style.height = 'auto';
      
      const caseNotesHeight = caseNotesRef.current.scrollHeight + 4;
      const labResultsHeight = labResultsRef.current.scrollHeight + 4;
      const totalHeight = caseNotesHeight + labResultsHeight + 20; // 20px for gap
      
      if (totalHeight > maxTotalHeight) {
        // Need to constrain heights
        const availableForTextareas = maxTotalHeight - 20; // Subtract gap
        const caseNotesRatio = caseNotesHeight / totalHeight;
        const labResultsRatio = labResultsHeight / totalHeight;
        
        const caseNotesMaxHeight = Math.floor(availableForTextareas * caseNotesRatio);
        const labResultsMaxHeight = Math.floor(availableForTextareas * labResultsRatio);
        
        caseNotesRef.current.style.height = Math.min(caseNotesHeight, caseNotesMaxHeight) + 'px';
        caseNotesRef.current.style.overflowY = caseNotesHeight > caseNotesMaxHeight ? 'auto' : 'hidden';
        
        labResultsRef.current.style.height = Math.min(labResultsHeight, labResultsMaxHeight) + 'px';
        labResultsRef.current.style.overflowY = labResultsHeight > labResultsMaxHeight ? 'auto' : 'hidden';
      } else {
        // Natural heights fit
        caseNotesRef.current.style.height = caseNotesHeight + 'px';
        caseNotesRef.current.style.overflowY = 'hidden';
        
        labResultsRef.current.style.height = labResultsHeight + 'px';
        labResultsRef.current.style.overflowY = 'hidden';
      }
    } else {
      // Single textarea
      adjustTextareaHeight(caseNotesRef.current);
      adjustTextareaHeight(labResultsRef.current);
    }
  };

  useEffect(() => {
    adjustAllTextareas();
  }, [localCaseNotes, localLabResults, showLabResults]);

  // Add resize observer to handle viewport changes
  useEffect(() => {
    const handleResize = () => {
      adjustAllTextareas();
    };

    window.addEventListener('resize', handleResize);
    
    // Also handle orientation change for mobile devices
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 100); // Small delay for orientation change to complete
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [showLabResults]);

  const handleClear = useCallback(() => {
    console.log('[CLEAR_DEBUG] CaseInputSection: handleClear called');
    console.log('[CLEAR_DEBUG] Before clear - localCaseNotes:', localCaseNotes, 'localLabResults:', localLabResults);
    handleClearAll();
    setLocalCaseNotes('');
    setLocalLabResults('');
    setCaseNotes('');
    setLabResults('');
    setShowLabResults(false);
    setHasInput(false);
    setInterimTranscript('');
    setFocusedInput('caseNotes');
    setImageFindings(null);
    setImagePreviewUrl(null);
    setImageFileName('');
    setShowExampleMenu(false);
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      console.log('[CLEAR_DEBUG] CaseInputSection: Speech recognition stopped');
    }
    if (caseNotesRef.current) {
      caseNotesRef.current.style.height = 'auto';
    }
    if (labResultsRef.current) {
      labResultsRef.current.style.height = 'auto';
    }
    console.log('[CLEAR_DEBUG] CaseInputSection: Textarea heights reset');
    
    // Force a re-render to ensure the UI updates
    setTimeout(() => {
      console.log('[CLEAR_DEBUG] After timeout - localCaseNotes:', localCaseNotes, 'localLabResults:', localLabResults);
    }, 0);
  }, [isListening, handleClearAll, setCaseNotes, setLabResults]);

  // Add this new effect to log state changes
  useEffect(() => {
    console.log('[CLEAR_DEBUG] State changed - localCaseNotes:', localCaseNotes, 'localLabResults:', localLabResults, 'hasInput:', hasInput);
  }, [localCaseNotes, localLabResults, hasInput]);

  const handleLoadLeukemiaExample = () => {
    setShowExampleMenu(false);
    setImageFindings(null);
    setImagePreviewUrl(null);
    setImageFileName('');

    setLocalCaseNotes(presetCaseNotes);
    setLocalLabResults(presetLabResults);
    setCaseNotes(presetCaseNotes);
    setLabResults(presetLabResults);
    setShowLabResults(true);
    setHasInput(true);

    setTimeout(() => {
      adjustAllTextareas();
    }, 50);

    if (typeof handleExampleLoad === 'function') {
      handleExampleLoad(presetCaseNotes, presetLabResults);
    }
  };

  const handleLoadSampleTBCXR = () => {
    setShowExampleMenu(false);
    setShowImageModal(false);
    setImageFileName('sample_tb_cxr.jpg');
    setImagePreviewUrl('/sample_tb_cxr.jpg');
    setImageFindings(presetTBFindings);

    setLocalCaseNotes(presetTBCaseNotes);
    setLocalLabResults(presetTBLabResults);
    setCaseNotes(presetTBCaseNotes);
    setLabResults(presetTBLabResults);
    setShowLabResults(true);
    setHasInput(true);

    setTimeout(() => {
      adjustAllTextareas();
    }, 50);

    if (typeof handleExampleLoad === 'function') {
      handleExampleLoad(presetTBCaseNotes, presetTBLabResults);
    }
  };

  const handleExampleClick = () => {
    setShowExampleMenu(prev => !prev);
  };

  const handleImageFileSelect = async (file) => {
    setShowImageModal(false);
    setImageFileName(file.name);
    setError(null);
    setIsAnalyzingImage(true);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target.result.split(',')[1];
          const result = await analyzeMedicalImage(base64Data, file.name, 'tuberculosis');

          setImageFindings(result);
          setImagePreviewUrl(result.previewImage || e.target.result);

          const reportText = result.summaryText || result.primaryImpression;
          if (reportText) {
            setCaseNotes(prevNotes => {
              const modalityLabel = result.metadata?.Modality ? `DICOM ${result.metadata.Modality}` : 'Thoracic Radiograph';
              const newNotes = prevNotes.trim()
                ? `${prevNotes}\n\n[Thoracic Imaging Findings (${modalityLabel})]:\n${reportText}`
                : `[Thoracic Imaging Findings (${modalityLabel})]:\n${reportText}`;
              setLocalCaseNotes(newNotes);
              return newNotes;
            });
            setHasInput(true);
          }

          setTimeout(() => {
            adjustAllTextareas();
          }, 100);
        } catch (err) {
          console.error('Error analyzing medical image:', err);
          setError(`Image analysis failed: ${err.message}`);
        } finally {
          setIsAnalyzingImage(false);
        }
      };

      reader.onerror = () => {
        setError('Failed to read image file');
        setIsAnalyzingImage(false);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error reading image file:', err);
      setError('Failed to read image file');
      setIsAnalyzingImage(false);
    }
  };


  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('Please select a PDF file');
      return;
    }

    setPdfFileName(file.name);
    setError(null);
    setIsProcessingPDF(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // Extract base64 data (remove data:application/pdf;base64, prefix)
          const base64Data = e.target.result.split(',')[1];
          
          // Call the backend to process the PDF
          const extractedData = await processLabPDF(base64Data);
          
          // Set the lab results with the extracted text data
          setLocalLabResults(extractedData);
          setLabResults(extractedData);
          setShowLabResults(true);
          
          // Adjust textarea height after content is set
          setTimeout(() => {
            adjustAllTextareas();
          }, 0);
          
        } catch (error) {
          console.error('Error processing lab:', error);
          setError(`Failed to process PDF: ${error.message}`);
        } finally {
          setIsProcessingPDF(false);
        }
      };

      reader.onerror = () => {
        setError('Failed to read PDF file');
        setIsProcessingPDF(false);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error reading file:', error);
      setError('Failed to read PDF file');
      setIsProcessingPDF(false);
    }

    // Reset file input
    event.target.value = '';
  };

  const toggleLabResults = () => {
    // When clicking "Add lab results", show modal with options
    if (!showLabResults) {
      setShowLabInputChoiceModal(true);
    } else {
      setShowLabResults(false);
      setPdfFileName('');
    }
  };

  const handleModalUploadClick = () => {
    setShowLabInputChoiceModal(false);
    fileInputRef.current?.click();
  };

  const handleModalTextClick = () => {
    setShowLabInputChoiceModal(false);
    setShowLabResults(true);
    // Focus on the lab results textarea after it's shown
    setTimeout(() => {
      if (labResultsRef.current) {
        labResultsRef.current.focus();
      }
    }, 100);
  };

  const handleModalClose = () => {
    setShowLabInputChoiceModal(false);
  };

  if (!showCaseInput) {
    return null;
  }

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      
      <div className="case-input-container bg-white border border-gray-200 rounded-xl p-4 sm:p-6 w-full flex flex-col transition-all duration-300 ease-in-out shadow-sm hover:shadow-md relative mb-8 mt-12" style={{ maxHeight: `${calculateContainerMaxHeight()}px` }}>
      {(isRedacting || isProcessingPDF || isAnalyzingImage) && (
        <div className="absolute top-0 left-0 right-0 bg-blue-100 bg-opacity-95 text-blue-800 px-3 py-1.5 text-xs z-20 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center">
            <svg className="animate-spin h-3.5 w-3.5 mr-2 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {isAnalyzingImage
              ? 'Gemini Multimodal Vision is analyzing chest imaging (extracting cavitations, consolidations, drug resistance indicators)...'
              : isProcessingPDF
              ? 'Processing lab report...'
              : 'Redacting sensitive information...'}
          </div>
        </div>
      )}
      <div className="flex-grow flex flex-col" style={{ overflowY: 'auto' }}>
        {imageFindings && (
          <RadiologyFindingsCard
            findingsData={imageFindings}
            previewUrl={imagePreviewUrl}
            onRemove={() => {
              setImageFindings(null);
              setImagePreviewUrl(null);
              setImageFileName('');
            }}
          />
        )}

        <div className="relative">
          <textarea
            ref={caseNotesRef}
            className="w-full bg-transparent text-gray-800 text-sm placeholder-gray-400 border-none focus:outline-none resize-none mb-2 overflow-y-auto"
            value={localCaseNotes + (focusedInput === 'caseNotes' && isListening ? ' ' + interimTranscript : '')}
            onChange={handleCaseNotesChange}
            onFocus={handleCaseNotesFocus}
            onBlur={handleCaseNotesBlur}
            placeholder="Please input your case notes or upload a chest radiograph / DICOM scan above"
            style={{ minHeight: '3em' }}
          />
        </div>
        
        {showLabResults && (
          <div className="mt-2 pt-4 border-t border-gray-100">
            <textarea
              ref={labResultsRef}
              className="w-full bg-transparent text-gray-800 text-sm placeholder-gray-400 border-none focus:outline-none resize-none overflow-y-auto"
              value={localLabResults + (focusedInput === 'labResults' && isListening ? ' ' + interimTranscript : '')}
              onChange={handleLabResultsChange}
              onFocus={handleLabResultsFocus}
              onBlur={handleLabResultsBlur}
              placeholder="Enter lab results here"
              style={{ minHeight: '3em' }}
            />
          </div>
        )}
      </div>
      
      <div className="flex flex-col sm:flex-row items-center justify-between mt-4 sm:mt-2 flex-shrink-0 relative">
        <div className="w-full sm:w-auto flex items-center justify-between mb-4 sm:mb-0">
          <div className="flex items-center">
            <button
              onClick={toggleLabResults}
              className="flex items-center text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showLabResults ? "M20 12H4" : "M12 4v16m8-8H4"} />
              </svg>
              {showLabResults ? 'Hide labs' : 'Add labs'}
            </button>
            <button
              onClick={() => setShowImageModal(true)}
              className="flex items-center text-indigo-600 hover:text-indigo-700 text-sm font-medium transition-colors duration-200 ml-4"
            >
              <FileImage className="h-4 w-4 mr-1.5" />
              {imageFindings ? 'Update Scan' : 'Upload CXR / DICOM'}
            </button>
          </div>
          <div className="flex items-center ml-4 sm:ml-8">
            <label htmlFor="numArticles" className="text-gray-600 hover:text-gray-800 text-sm font-medium transition-colors duration-200 mr-2"># of articles:</label>
            <input
              id="numArticles"
              type="number"
              min="1"
              max="50"
              value={numArticles}
              onChange={(e) => {
                const value = Math.min(50, Math.max(1, parseInt(e.target.value) || 15));
                setNumArticles(value);
              }}
              className="w-16 p-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="relative">
            <button
              onClick={handleExampleClick}
              className="flex items-center text-gray-600 hover:text-gray-800 text-sm font-medium transition-colors duration-200"
            >
              Example <ChevronDown className="w-3.5 h-3.5 ml-1" />
            </button>
            {showExampleMenu && (
              <div className="absolute right-0 bottom-full mb-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-30 text-left animate-fadeIn">
                <button
                  onClick={handleLoadSampleTBCXR}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 text-gray-800 flex items-center justify-between transition-colors"
                >
                  <div>
                    <div className="font-semibold text-xs text-blue-700">Tuberculosis + CXR</div>
                    <div className="text-[11px] text-gray-500">Cavitary MDR-TB & CXR scan</div>
                  </div>
                  <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">TB Portals</span>
                </button>
                <button
                  onClick={handleLoadLeukemiaExample}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center justify-between border-t border-gray-100 transition-colors"
                >
                  <div>
                    <div className="font-medium text-xs text-gray-800">Pediatric Leukemia</div>
                    <div className="text-[11px] text-gray-500">KMT2A-rearranged AML</div>
                  </div>
                  <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">iLTB</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleClear}
            className="text-gray-600 hover:text-gray-800 text-sm font-medium transition-colors duration-200"
          >
            Clear
          </button>
          <button
            onClick={handleButtonClick}
            disabled={isProcessing}
            className={`flex items-center justify-center rounded-full w-10 h-10 focus:outline-none focus:ring-2 transition-all duration-300 shadow-sm ${
              isProcessing ? "bg-gray-400 text-white focus:ring-gray-300" :
              isListening ? "bg-red-500 hover:bg-red-600 text-white focus:ring-red-300 animate-pulse" :
              hasInput ? "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-300" :
              "bg-gray-700 hover:bg-gray-800 text-white focus:ring-gray-400"
            }`}
          >
            {isProcessing ? (
              <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
            ) : isListening ? (
              <MicOff className="w-5 h-5" />
            ) : hasInput ? (
              <ArrowRight className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
      {error && (
        <div className="text-red-500 flex items-center mt-2">
          <AlertTriangle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}
    </div>
    
    {/* Lab Input Choice Modal */}
    <LabInputModal
      isOpen={showLabInputChoiceModal}
      onClose={handleModalClose}
      onUploadClick={handleModalUploadClick}
      onTextClick={handleModalTextClick}
    />

    {/* Medical Image / DICOM Input Modal */}
    <ImageInputModal
      isOpen={showImageModal}
      onClose={() => setShowImageModal(false)}
      onFileSelect={handleImageFileSelect}
      onLoadSample={handleLoadSampleTBCXR}
    />
    </>
  );
};

export default CaseInputSection;
