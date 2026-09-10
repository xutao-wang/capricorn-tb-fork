# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import base64
from io import BytesIO
import json
import logging
import os

from flask import jsonify, request
import functions_framework
from google import genai
from google.genai import types
import numpy as np
from PIL import Image
import pydicom

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def is_dicom_bytes(data: bytes, file_name: str = "") -> bool:
    """Check if the provided bytes represent a DICOM image."""
    if file_name and file_name.lower().endswith(('.dcm', '.dicom')):
        return True
    if len(data) > 132 and data[128:132] == b"DICM":
        return True
    try:
        pydicom.dcmread(BytesIO(data), stop_before_pixels=True)
        return True
    except Exception:
        return False


def process_dicom(data: bytes):
    """Parses DICOM data, extracts metadata, windows the pixel array, and produces JPEG bytes."""
    ds = pydicom.dcmread(BytesIO(data), force=True)

    metadata = {}
    for tag in [
        'Modality', 'BodyPartExamined', 'ViewPosition', 'StudyDescription',
        'SeriesDescription', 'PatientSex', 'PatientAge', 'PhotometricInterpretation'
    ]:
        val = getattr(ds, tag, None)
        if val is not None:
            metadata[tag] = str(val)

    if not hasattr(ds, 'pixel_array'):
        raise ValueError("DICOM file contains no pixel data")

    arr = ds.pixel_array.astype(float)
    photometric = getattr(ds, 'PhotometricInterpretation', 'MONOCHROME2')
    if photometric == 'MONOCHROME1':
        arr = np.amax(arr) - arr

    # Apply Window Center and Window Width if available
    window_center = getattr(ds, 'WindowCenter', None)
    window_width = getattr(ds, 'WindowWidth', None)
    if window_center is not None and window_width is not None:
        try:
            if isinstance(window_center, (list, pydicom.multival.MultiValue)):
                window_center = window_center[0]
            if isinstance(window_width, (list, pydicom.multival.MultiValue)):
                window_width = window_width[0]
            c = float(window_center)
            w = float(window_width)
            min_val = c - 0.5 - (w - 1) / 2
            max_val = c - 0.5 + (w - 1) / 2
            arr = np.clip(arr, min_val, max_val)
        except Exception as e:
            logger.warning(f"Error applying DICOM windowing: {e}")

    amin = np.amin(arr)
    amax = np.amax(arr)
    if amax > amin:
        arr = ((arr - amin) / (amax - amin) * 255.0).astype(np.uint8)
    else:
        arr = np.zeros_like(arr, dtype=np.uint8)

    pil_img = Image.fromarray(arr)
    if pil_img.mode != 'RGB':
        pil_img = pil_img.convert('RGB')

    # Constrain max dimension to 2048px for fast vision transfer
    max_dim = 2048
    if max(pil_img.size) > max_dim:
        pil_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    out_buf = BytesIO()
    pil_img.save(out_buf, format='JPEG', quality=92)
    jpeg_bytes = out_buf.getvalue()

    metadata['OriginalDimensions'] = f"{pil_img.width}x{pil_img.height}"
    metadata['Format'] = 'DICOM'
    return jpeg_bytes, metadata


def process_standard_image(data: bytes, file_name: str = ""):
    """Processes standard image formats (PNG, JPEG, WebP, etc.) into JPEG bytes."""
    pil_img = Image.open(BytesIO(data))
    if pil_img.mode not in ('RGB', 'L'):
        pil_img = pil_img.convert('RGB')
    elif pil_img.mode == 'L':
        pil_img = pil_img.convert('RGB')

    max_dim = 2048
    if max(pil_img.size) > max_dim:
        pil_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    out_buf = BytesIO()
    pil_img.save(out_buf, format='JPEG', quality=92)
    jpeg_bytes = out_buf.getvalue()

    metadata = {
        'Format': pil_img.format or (file_name.split('.')[-1].upper() if '.' in file_name else 'IMAGE'),
        'OriginalDimensions': f"{pil_img.width}x{pil_img.height}",
    }
    return jpeg_bytes, metadata


@functions_framework.http
def analyze_image(request):
    """HTTP Cloud Function to analyze medical chest images (DICOM, PNG, JPEG)

    for Tuberculosis and pulmonary disease using Gemini Multimodal Vision.
    """
    # Handle CORS preflight requests
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    }

    try:
        request_json = request.get_json(silent=True)
        if not request_json or 'image_data' not in request_json:
            logger.error("Invalid request: Missing image_data in JSON payload.")
            return jsonify({'error': 'Missing image_data in JSON payload'}), 400, headers

        image_base64 = request_json['image_data']
        file_name = request_json.get('file_name', '')
        specialty_id = request_json.get('specialty_id', 'tuberculosis')

        try:
            raw_bytes = base64.b64decode(image_base64)
        except Exception as e:
            logger.error(f"Invalid base64 data: {e}")
            return jsonify({'error': f'Invalid base64 data: {e}'}), 400, headers

        # Convert DICOM or standard image to normalized JPEG
        if is_dicom_bytes(raw_bytes, file_name):
            logger.info(f"Processing DICOM file: {file_name}")
            jpeg_bytes, metadata = process_dicom(raw_bytes)
        else:
            logger.info(f"Processing standard image file: {file_name}")
            jpeg_bytes, metadata = process_standard_image(raw_bytes, file_name)

        # Initialize Vertex AI client
        client = genai.Client(
            vertexai=True,
            project=os.environ.get('PROJECT_ID', 'onboarding-sandbox-477121'),
            location=os.environ.get('LOCATION', 'global'),
        )

        image_part = types.Part.from_bytes(
            data=jpeg_bytes,
            mime_type="image/jpeg",
        )

        metadata_str = "\n".join(f"- {k}: {v}" for k, v in metadata.items())
        prompt_text = f"""You are an expert thoracic radiologist and infectious disease specialist evaluating a chest imaging study (radiograph or CT) for pulmonary tuberculosis (TB) and related mycobacterial/infectious diseases.

Known Image Metadata:
{metadata_str}

Perform a thorough, expert radiological analysis with a particular focus on tuberculosis phenotypes (cavitation, consolidations, tree-in-bud opacities, miliary distribution, pleural effusion, and lymphadenopathy) and their clinical significance for treatment selection and drug resistance risk.

Respond ONLY with valid JSON matching this exact schema:
{{
  "modality": "Chest Radiograph (PA/AP) or Chest CT",
  "technicalQuality": "Adequate / Satisfactory / Suboptimal",
  "primaryImpression": "Concise primary diagnostic impression summarizing all significant abnormalities",
  "cavitation": {{
    "detected": true,
    "location": "Specific anatomical lobe and segment, e.g. Right upper lobe apical segment, or 'None'",
    "description": "Cavity wall thickness, dimensions, inner wall contour, presence of fluid level, or 'None'",
    "clinicalSignificance": "Clinical significance regarding bacillary burden, treatment duration, infectiousness, and drug resistance risk"
  }},
  "parenchymalFindings": {{
    "consolidations": "Detailed description of airspace opacifications, air bronchograms, or 'None'",
    "infiltrates": "Patchy, acinar, or reticulonodular infiltrates, or 'None'",
    "treeInBud": "Branching centrilobular nodular opacities reflecting active endobronchial disease, or 'None'",
    "miliaryPattern": "Diffuse 1-3 mm hematogenous micronodules, or 'None'"
  }},
  "distributionAndSeverity": {{
    "laterality": "Bilateral / Unilateral Right / Unilateral Left",
    "zonesInvolved": ["Right Upper", "Right Middle", "Right Lower", "Left Upper", "Left Lower"],
    "severityGrade": "Mild (<10% lung involved) / Moderate (10-30%) / Severe (>30% or extensive cavitary destruction)"
  }},
  "pleuralAndMediastinalFindings": {{
    "pleuralEffusion": "Effusion details or 'None'",
    "pleuralThickening": "Thickening, apical capping, fibrothorax or 'None'",
    "lymphadenopathy": "Hilar or mediastinal lymph node enlargement or 'None'"
  }},
  "drugResistanceAndTreatmentRisk": "Assessment of disease severity in relation to acquired drug resistance risk, treatment duration, or surgical intervention considerations",
  "actionableEvents": [
    "Specific actionable radiological phenotype strings suitable for literature search, e.g. 'Right upper lobe cavitation', 'Bilateral apical consolidation', 'Tree-in-bud opacities', 'Far-advanced cavitary pulmonary tuberculosis', 'High bacillary burden with cavitation'"
  ],
  "radiologyReportText": "A professional 1-paragraph clinical radiology note synthesizing all key findings in standard medical reporting language, suitable for pasting into medical case notes."
}}
"""

        text_part = types.Part.from_text(text=prompt_text)

        model = "gemini-2.5-flash"
        contents = [
            types.Content(
                role="user",
                parts=[image_part, text_part]
            )
        ]

        generate_content_config = types.GenerateContentConfig(
            temperature=0.2,
            top_p=0.95,
            candidate_count=1,
            max_output_tokens=4096,
            response_mime_type="application/json",
            safety_settings=[
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
            ],
        )

        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_content_config,
        )

        if not response.text:
            logger.error("Gemini returned empty response")
            return jsonify({'error': 'Vision model returned empty response'}), 500, headers

        cleaned_text = response.text.strip()
        if cleaned_text.startswith("```json"):
            cleaned_text = cleaned_text.split("```json")[1].split("```")[0].strip()
        elif cleaned_text.startswith("```"):
            cleaned_text = cleaned_text.split("```")[1].split("```")[0].strip()

        try:
            parsed_json = json.loads(cleaned_text)
        except Exception as e:
            logger.warning(f"Failed to parse JSON directly: {e}, text: {cleaned_text[:200]}")
            parsed_json = {
                "primaryImpression": cleaned_text[:200],
                "radiologyReportText": cleaned_text,
                "actionableEvents": ["Radiological chest findings detected"],
                "cavitation": {"detected": "cavit" in cleaned_text.lower()}
            }

        preview_b64 = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode('utf-8')

        return jsonify({
            'success': True,
            'data': {
                'parsedFindings': parsed_json,
                'summaryText': parsed_json.get('radiologyReportText', ''),
                'actionableEvents': parsed_json.get('actionableEvents', []),
                'primaryImpression': parsed_json.get('primaryImpression', ''),
                'cavitation': parsed_json.get('cavitation', {}),
                'severity': parsed_json.get('distributionAndSeverity', {}).get('severityGrade', ''),
                'metadata': metadata,
                'previewImage': preview_b64
            }
        }), 200, headers

    except Exception as e:
        logger.error(f"Error in analyze_image: {str(e)}", exc_info=True)
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500, headers


if __name__ == "__main__":
    app = functions_framework.create_app(target="analyze_image")
    app.run(host="0.0.0.0", port=8080, debug=True)
