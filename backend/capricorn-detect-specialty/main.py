import functions_framework
from flask import jsonify, request
from google import genai
from google.genai import types
import json
import logging
import os

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
    project=os.environ.get('PROJECT_ID'),
    location=os.environ.get('LOCATION'),
)

MODEL = "gemini-3.1-flash-lite"
GENERATE_CONTENT_CONFIG = types.GenerateContentConfig(
    temperature=1,
    top_p=0.95,
    candidate_count=1,
    max_output_tokens=1024,
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
        max_output_tokens=max_output_tokens,
        response_modalities=GENERATE_CONTENT_CONFIG.response_modalities,
        safety_settings=GENERATE_CONTENT_CONFIG.safety_settings,
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=[types.Content(role="user", parts=[{"text": prompt}])],
        config=config,
    )
    return response.text


def _classify(specialties, case_text):
    """Returns the parsed classification dict, tolerating markdown fences and
    falling back to a low-confidence null result on parse failure (the
    caller treats that the same as "no good fit")."""
    labels_by_id = {s['id']: s['label'] for s in specialties}
    prompt = build_detection_prompt(specialties, case_text)
    try:
        parsed = _extract_json(_call_gemini(prompt))
    except (json.JSONDecodeError, AttributeError, Exception) as e:
        logger.error(f"Classification parse failed: {e}")
        return {'specialtyId': None, 'confidence': 0, 'rationale': '',
                'suggestedLabel': None, 'suggestedDescription': None}

    specialty_id = parsed.get('specialtyId')
    if specialty_id is not None and specialty_id not in labels_by_id:
        logger.warning(f"Model returned unrecognized specialtyId '{specialty_id}'")
        specialty_id = None

    return {
        'specialtyId': specialty_id,
        'confidence': parsed.get('confidence', 0) or 0,
        'rationale': parsed.get('rationale', ''),
        'suggestedLabel': parsed.get('suggestedLabel'),
        'suggestedDescription': parsed.get('suggestedDescription'),
    }


def _generate_persona(specialties, case_text, suggested_label, suggested_description):
    """Generates a new specialty config, validating (with one retry) before
    saving. Returns the saved config dict, or None if generation failed
    twice -- the caller falls back to general-medicine in that case."""
    prompt = build_persona_generation_prompt(specialties, case_text, suggested_label, suggested_description)

    for attempt in range(2):
        try:
            config = _extract_json(_call_gemini(prompt, max_output_tokens=8192))
        except (json.JSONDecodeError, AttributeError) as e:
            logger.error(f"Persona generation parse failed (attempt {attempt + 1}): {e}")
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
        logger.info(f"Classification: {classification}")

        good_fit = (
            classification['specialtyId'] is not None
            and classification['confidence'] >= CONFIDENCE_THRESHOLD
        )

        if good_fit:
            labels_by_id = {s['id']: s['label'] for s in specialties}
            result = {
                'specialtyId': classification['specialtyId'],
                'label': labels_by_id[classification['specialtyId']],
                'rationale': classification['rationale'],
                'confidence': classification['confidence'],
                'generated': False,
            }
            logger.info(f"Detected specialty: {result['specialtyId']} (confidence {result['confidence']})")
            return (jsonify(result), 200, headers)

        suggested_label = classification.get('suggestedLabel') or 'New Specialty'
        suggested_description = classification.get('suggestedDescription') or 'Generated from a case that did not clearly match an existing specialty.'
        logger.info(f"No confident match (confidence={classification['confidence']}); generating new persona for '{suggested_label}'")

        generated = _generate_persona(specialties, text, suggested_label, suggested_description)
        if generated:
            result = {
                'specialtyId': generated['id'],
                'label': generated['label'],
                'rationale': f"Generated a new specialty ('{generated['label']}') because no existing one fit this case well.",
                'confidence': classification['confidence'],
                'generated': True,
                'reviewStatus': 'pending',
            }
            logger.info(f"Generated and saved new specialty: {result['specialtyId']}")
            return (jsonify(result), 200, headers)

        # Generation failed twice -- fall back rather than block the pipeline.
        labels_by_id = {s['id']: s['label'] for s in specialties}
        result = {
            'specialtyId': DEFAULT_SPECIALTY_ID,
            'label': labels_by_id.get(DEFAULT_SPECIALTY_ID, 'General Medicine'),
            'rationale': 'Could not confidently classify or generate a specialty for this case; defaulted to general medicine.',
            'confidence': classification['confidence'],
            'generated': False,
        }
        logger.warning("Persona generation failed twice; falling back to general-medicine")
        return (jsonify(result), 200, headers)

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return (jsonify({"error": str(e)}), 500, headers)


if __name__ == "__main__":
    # This is used when running locally only. When deploying to Google Cloud Functions,
    # a webserver will be used to run the app instead
    app = functions_framework.create_app(target="detect_specialty")
    port = int(os.environ.get('PORT', 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
