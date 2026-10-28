import functions_framework
from flask import jsonify, request
from google import genai
from google.genai import types
import json
import logging
import os
import math
from capricorn_runtime import config as runtime
from capricorn_runtime.security import protected_http

from specialty import (
    list_specialties,
    build_detection_prompt,
    build_persona_generation_prompt,
    validate_specialty_config,
    unique_specialty_id,
    save_generated_specialty,
    DEFAULT_SPECIALTY_ID,
    CONFIDENCE_THRESHOLD,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize Vertex AI client
client = genai.Client(
    vertexai=True,
    project=runtime.project_id(),
    location=os.environ.get('LOCATION'),
)

MODEL = runtime.model_name("gemini-3.1-flash-lite")
GENERATE_CONTENT_CONFIG = types.GenerateContentConfig(
    temperature=1,
    top_p=0.95,
    candidate_count=1,
    max_output_tokens=runtime.output_token_limit(1024),
    response_modalities=["TEXT"],
    safety_settings=[
        types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
        types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    ],
)


def _extract_json(text):
    cleaned = text.strip()
    if '```json' in cleaned:
        cleaned = cleaned.split('```json')[1].split('```')[0].strip()
    elif '{' in cleaned and '}' in cleaned:
        start = cleaned.find('{')
        end = cleaned.rfind('}') + 1
        cleaned = cleaned[start:end]
    return json.loads(cleaned)


def _call_gemini(prompt, max_output_tokens=1024):
    config = types.GenerateContentConfig(
        temperature=GENERATE_CONTENT_CONFIG.temperature,
        top_p=GENERATE_CONTENT_CONFIG.top_p,
        candidate_count=GENERATE_CONTENT_CONFIG.candidate_count,
        max_output_tokens=runtime.output_token_limit(max_output_tokens),
        response_modalities=GENERATE_CONTENT_CONFIG.response_modalities,
        safety_settings=GENERATE_CONTENT_CONFIG.safety_settings,
        response_mime_type="application/json",
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=[types.Content(role="user", parts=[{"text": prompt}])],
        config=config,
    )
    return response.text


def _classify(specialties, case_text):
    """Classify real clinical cases; service failures and non-cases never create a persona."""
    empty = {'isClinicalCase': False, 'specialtyId': None, 'confidence': 0,
             'rationale': '', 'suggestedLabel': None, 'suggestedDescription': None}
    prompt = build_detection_prompt(specialties, case_text)
    try:
        parsed = _extract_json(_call_gemini(prompt))
    except Exception as e:
        logger.error('Classification failed: %s', type(e).__name__)
        return {**empty, 'error': 'CLASSIFICATION_UNAVAILABLE'}
    if not isinstance(parsed, dict):
        return {**empty, 'error': 'INVALID_CLASSIFICATION'}
    labels_by_id = {s['id']: s['label'] for s in specialties}
    specialty_id = parsed.get('specialtyId')
    if specialty_id is not None and (not isinstance(specialty_id, str) or specialty_id not in labels_by_id):
        logger.warning('Model returned unrecognized specialty ID')
        specialty_id = None
    confidence = parsed.get('confidence', 0)
    if (type(parsed.get('isClinicalCase')) is not bool
            or type(confidence) not in (int, float) or not math.isfinite(confidence)
            or not 0 <= confidence <= 100):
        return {**empty, 'error': 'INVALID_CLASSIFICATION'}
    if parsed['isClinicalCase'] is False:
        return empty
    def bounded_text(key, limit):
        value = parsed.get(key)
        return value[:limit] if isinstance(value, str) else None
    return {'isClinicalCase': True, 'specialtyId': specialty_id, 'confidence': confidence,
            'rationale': bounded_text('rationale', 600) or '',
            'suggestedLabel': bounded_text('suggestedLabel', 80),
            'suggestedDescription': bounded_text('suggestedDescription', 500)}


def _generate_persona(specialties, case_text, suggested_label, suggested_description):
    """Generates a new specialty config, validating (with one retry) before
    saving. Returns the saved config dict, or None if generation failed
    twice -- the caller falls back to general-medicine in that case."""
    prompt = build_persona_generation_prompt(specialties, case_text, suggested_label, suggested_description)

    for attempt in range(2):
        try:
            config = _extract_json(_call_gemini(prompt, max_output_tokens=8192))
        except Exception as e:
            logger.error("Persona generation failed (attempt %s): %s", attempt + 1, type(e).__name__)
            continue

        # Assign a collision-free id regardless of what the model proposed.
        existing_ids = {s['id'] for s in specialties}
        config['id'] = unique_specialty_id(config.get('id') or suggested_label, existing_ids)

        is_valid, error = validate_specialty_config(config)
        if is_valid:
            return save_generated_specialty(config, case_text)
        logger.error(f"Generated persona failed validation (attempt {attempt + 1}): {error}")

    return None


@functions_framework.http
@protected_http
def detect_specialty(request):
    # Enable CORS
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        request_json = request.get_json()
        if not request_json:
            return jsonify({'error': 'No JSON data received'}), 400, headers

        text = request_json.get('text')
        if not text:
            return jsonify({'error': 'Missing text field'}), 400, headers

        specialties = list_specialties()
        classification = _classify(specialties, text)
        logger.info("Specialty classification completed")
        if classification.get('error'):
            status = 503 if classification['error'] == 'CLASSIFICATION_UNAVAILABLE' else 502
            return jsonify({'error': 'Clinical case classification is temporarily unavailable',
                            'code': classification['error']}), status, headers
        if classification.get('isClinicalCase') is not True:
            return jsonify({'error': 'Provide clinical case notes or reviewed imaging findings.',
                            'code': 'NO_CLINICAL_CASE'}), 422, headers

        good_fit = (
            classification['specialtyId'] is not None
            and classification['confidence'] >= CONFIDENCE_THRESHOLD
        )

        if good_fit:
            labels_by_id = {s['id']: s['label'] for s in specialties}
            result = {
                'isClinicalCase': True,
                'specialtyId': classification['specialtyId'],
                'label': labels_by_id[classification['specialtyId']],
                'rationale': classification['rationale'],
                'confidence': classification['confidence'],
                'generated': False,
            }
            logger.info("Existing specialty selected")
            return (jsonify(result), 200, headers)

        suggested_label = classification.get('suggestedLabel') or 'New Specialty'
        suggested_description = classification.get('suggestedDescription') or 'Generated from a case that did not clearly match an existing specialty.'
        logger.info("No confident match; generating new persona")

        generated = _generate_persona(specialties, text, suggested_label, suggested_description)
        if generated:
            result = {
                'isClinicalCase': True,
                'specialtyId': generated['id'],
                'label': generated['label'],
                'rationale': f"Generated a new specialty ('{generated['label']}') because no existing one fit this case well.",
                'confidence': classification['confidence'],
                'generated': True,
                'reviewStatus': 'pending',
            }
            logger.info("Generated and saved new specialty")
            return (jsonify(result), 200, headers)

        # Generation failed twice -- fall back rather than block the pipeline.
        labels_by_id = {s['id']: s['label'] for s in specialties}
        result = {
            'isClinicalCase': True,
            'specialtyId': DEFAULT_SPECIALTY_ID,
            'label': labels_by_id.get(DEFAULT_SPECIALTY_ID, 'General Medicine'),
            'rationale': 'Could not confidently classify or generate a specialty for this case; defaulted to general medicine.',
            'confidence': classification['confidence'],
            'generated': False,
        }
        logger.warning("Persona generation failed twice; falling back to general-medicine")
        return (jsonify(result), 200, headers)

    except Exception as e:
        logger.error(f"Error processing request: {type(e).__name__}")
        return (jsonify({"error": "The request could not be completed"}), 500, headers)


if __name__ == "__main__":
    # This is used when running locally only. When deploying to Google Cloud Functions,
    # a webserver will be used to run the app instead
    app = functions_framework.create_app(target="detect_specialty")
    port = int(os.environ.get('PORT', 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
