import functions_framework
from flask import jsonify, request
from google import genai
from google.genai import types
import logging
import os
import json
from capricorn_runtime import config as runtime
from capricorn_runtime.security import protected_http
from capricorn_runtime.clinical import event_results, ExtractionValidationError

from specialty import get_specialty, build_event_extraction_prompt

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize Vertex AI client
client = genai.Client(
    vertexai=True,
    project=runtime.project_id(),
    location=os.environ.get('LOCATION', 'global'),
)

@functions_framework.http
@protected_http
def extract_events(request):
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

        specialty = get_specialty(request_json.get('specialtyId'))
        print(f"Using specialty: {specialty['id']}")
        prompt = build_event_extraction_prompt(specialty)
        full_text = f"{prompt}\n\nCase input:\n{text}"

        # Create content for Gemini
        contents = [
            types.Content(
                role="user",
                parts=[{"text": full_text}]
            )
        ]

        # Configure Gemini model. Extraction is pure reading comprehension of the
        # case notes — no external lookup needed — so no Google Search grounding.
        # flash-lite is fast and fully sufficient for this task.
        model = runtime.model_name("gemini-3.1-flash-lite")
        generate_content_config = types.GenerateContentConfig(
            temperature=1,
            top_p=0.95,
            candidate_count=1,
            max_output_tokens=runtime.output_token_limit(8192),
            response_modalities=["TEXT"],
            safety_settings=[
                types.SafetySetting(
                    category="HARM_CATEGORY_HATE_SPEECH",
                    threshold="OFF"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold="OFF"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold="OFF"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_HARASSMENT",
                    threshold="OFF"
                )
            ],
        )

        # Generate response using Gemini
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_content_config,
        )

        return (' '.join(json.dumps(event) for event in event_results(response.text)), 200, headers)

    except ExtractionValidationError as e:
        return jsonify({'error': str(e), 'code': e.code}), 422, headers
    except Exception as e:
        logger.error(f"Error processing request: {type(e).__name__}")
        return (jsonify({"error": "The request could not be completed"}), 500, headers)

if __name__ == "__main__":
    # This is used when running locally only. When deploying to Google Cloud Functions,
    # a webserver will be used to run the app instead
    app = functions_framework.create_app(target="extract_events")
    port = int(os.environ.get('PORT', 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
