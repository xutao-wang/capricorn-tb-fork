# Copyright 2025 Google LLC
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

import functions_framework
from flask import jsonify, request
from google import genai
from google.genai import types
import base64
import json
import logging
import os
from capricorn_runtime import config as runtime
from capricorn_runtime.security import protected_http

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@functions_framework.http
@protected_http
def process_lab(request):
    """HTTP Cloud Function to process a PDF lab report and extract genomic information."""
    # Handle CORS preflight requests
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    }

    try:
        request_json = request.get_json(silent=True)
        if not request_json or 'pdf_data' not in request_json:
            logger.error("Invalid request: Missing pdf_data in JSON payload.")
            return jsonify({'error': 'Missing pdf_data in JSON payload'}), 400, headers

        pdf_base64 = request_json['pdf_data']
        
        try:
            pdf_bytes = base64.b64decode(pdf_base64)
        except Exception as e:
            logger.error("Invalid base64 data: %s", type(e).__name__)
            return jsonify({'error': 'Invalid base64 data'}), 400, headers

        # Initialize GenAI Client with environment variables
        client = genai.Client(
            vertexai=True,
            project=runtime.project_id(),
            location=os.environ.get('LOCATION', 'global'),
        )

        # Create the PDF document part
        document1 = types.Part.from_bytes(
            data=pdf_bytes,
            mime_type="application/pdf",
        )

        # Create the text prompt part
        text1 = types.Part.from_text(text="""You are an expert bioinformatics assistant tasked with extracting specific information from a multi-page PDF genomic report.
The report contains several sections and plots. Please analyze all pages carefully.

Output Format:
Return the extracted information as simple, well-formatted text with clear sections and bullet points. Do not return JSON.

1. VARIANTS WITH VAF > 5%

Locate the table, likely on a page titled "HIX -- WES Variant Analysis", that lists "Varianten (>5% VAF)".

For each variant listed in this table, format as:
- Gene: [gene symbol], Variant: [full variant nomenclature], VAF: [percentage], Classification: [classification]

Example: 
- Gene: TAL1, Variant: TAL1(NM_003189.5):c.562C>T (p.Arg188Trp), VAF: 36.6%, Classification: 3VUS

2. GENES WITH ELEVATED DENOISED COPY RATIOS (DCR > 2.0)

Examine the plots titled "Tumor PMBBM... - Normal PMGBM... - Denoised Copy Ratio" found on later pages of the report (likely pages 5, 6, and 7, corresponding to different gene panels like panCancerCNV, hematoOncoCNV, neuroOncoCNV).

IMPORTANT: The baseline of 1.0 represents normal diploid state (2 copies). Only include genes where the tumor sample shows Denoised Copy Ratio STRICTLY GREATER than 2.0.

For each qualifying gene, format as:
- Gene: [gene symbol], Panel: [panel name], DCR: ~[value]

Example:
- Gene: MYC, Panel: panCancerCNV.bed, DCR: ~3.0
- Gene: CDK4, Panel: panCancerCNV.bed, DCR: ~3.0

If no genes meet the DCR > 2.0 criterion, write: "No genes with DCR > 2.0 detected"

3. CHROMOSOME LEVEL ABERRATIONS

Examine the chromosome-level denoised copy ratio plots (likely on pages 3 and 4). 

For gains: look for regions consistently at/above ~1.5 DCR
For losses: look for regions consistently at/below ~0.75 DCR

For each aberration, format as:
- Chromosome/Arm: [location], Change: [gain/loss], DCR: ~[range], Rationale: [brief explanation]

Example:
- Chromosome/Arm: 7, Change: gain, DCR: ~1.5-1.7, Rationale: Consistent visual increase along the entire chromosome
- Chromosome/Arm: 1p, Change: loss, DCR: ~0.5-0.6, Rationale: Clear drop across the p-arm with corresponding LOH

---

Example Output:

VARIANTS WITH VAF > 5%
- Gene: TAL1, Variant: TAL1(NM_003189.5):c.562C>T (p.Arg188Trp), VAF: 36.6%, Classification: 3VUS
- Gene: EZH2, Variant: EZH2(NM_004456.4):c.1937A>T (p.Tyr646Phe), VAF: 49.2%, Classification: 4LP
- Gene: SOCS1, Variant: SOCS1(NM_003745.1):c.512_517delTGCGGC (p.Val171_Pro173delinsAla), VAF: 32.1%, Classification: 3VUS

GENES WITH ELEVATED DENOISED COPY RATIOS (DCR > 2.0)
- Gene: MYC, Panel: panCancerCNV.bed, DCR: ~3.0
- Gene: CDK4, Panel: panCancerCNV.bed, DCR: ~3.0
- Gene: P2RY8, Panel: hematoOncoCNV.bed, DCR: ~4.0

CHROMOSOME LEVEL ABERRATIONS
- Chromosome/Arm: 7, Change: gain, DCR: ~1.5-1.7, Rationale: Consistent visual increase along the entire chromosome
- Chromosome/Arm: 18, Change: gain, DCR: ~1.5-1.7, Rationale: Consistent visual increase along the entire chromosome""")

        model = runtime.model_name("gemini-2.5-flash")
        contents = [
            types.Content(
                role="user",
                parts=[document1, text1]
            )
        ]

        generate_content_config = types.GenerateContentConfig(
            temperature=1,
            top_p=1,
            seed=0,
            max_output_tokens=runtime.output_token_limit(65535),
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
            response_mime_type="text/plain",
        )

        # Generate content from the model
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_content_config,
        )

        # The response should be in plain text format
        if not response.text:
            logger.error("GenAI returned an empty response.")
            return jsonify({'error': 'GenAI returned an empty response.'}), 500, headers

        # Return the plain text response
        logger.info(f"Successfully processed PDF and extracted genomic information")
        return jsonify({
            'success': True,
            'data': response.text
        }), 200, headers

    except Exception as e:
        logger.error(f"Error in process_lab: {type(e).__name__}")
        return jsonify({'error': f'An unexpected error occurred: {type(e).__name__}'}), 500, headers

if __name__ == "__main__":
    app = functions_framework.create_app(target="process_lab")
    app.run(host="0.0.0.0", port=8080, debug=True)
