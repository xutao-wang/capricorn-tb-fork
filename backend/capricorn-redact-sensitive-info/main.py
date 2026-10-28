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
from flask import jsonify
from google.cloud import dlp_v2
from google import genai
from google.genai import types
import json
import re
from datetime import datetime
import os
from capricorn_runtime import config as runtime
from capricorn_runtime.security import protected_http

# Initialize DLP client
dlp_client = dlp_v2.DlpServiceClient()

# Initialize Gemini client using Vertex AI with application-default credentials
GCP_PROJECT = runtime.project_id()
GCP_LOCATION = os.environ.get('LOCATION', 'global')  # gemini-3.1-pro-preview requires 'global' region
MODEL = runtime.model_name("gemini-3.1-flash-lite")

client = genai.Client(
    vertexai=True,
    project=GCP_PROJECT,
    location=GCP_LOCATION,
)

def get_info_types():
    """Get list of info types to redact, including DATE_OF_BIRTH."""
    all_types = [
        {"name": info_type}
       for info_type in [
            "EMAIL_ADDRESS",
            "STREET_ADDRESS",
            "LOCATION",
            "DATE_OF_BIRTH",
            "US_SOCIAL_SECURITY_NUMBER",
            "PASSPORT",
            "DRIVERS_LICENSE_NUMBER",
            "PHONE_NUMBER",
            "FIRST_NAME",
            "LAST_NAME",
            "PERSON_NAME",
            "MEDICAL_RECORD_NUMBER",
            "CREDIT_CARD_NUMBER",
            "CREDIT_CARD_EXPIRATION_DATE",
            "US_PASSPORT",
            "UK_DRIVERS_LICENSE_NUMBER",
            "AUSTRALIA_DRIVERS_LICENSE_NUMBER",
            "CANADA_DRIVERS_LICENSE_NUMBER",
            "GERMANY_DRIVERS_LICENSE_NUMBER",
            "US_DRIVERS_LICENSE_NUMBER",
            "IRELAND_DRIVING_LICENSE_NUMBER",
            "UK_PASSPORT",
            "FRANCE_DRIVERS_LICENSE_NUMBER",
            "MEXICO_CURP_NUMBER",
            "HONG_KONG_ID_NUMBER",
            "TAIWAN_ID_NUMBER",
            "BRAZIL_CPF_NUMBER",
            "ARGENTINA_DNI_NUMBER",
            "BELGIUM_NATIONAL_ID_CARD_NUMBER",
            "ITALY_FISCAL_CODE",
            "POLAND_PASSPORT",
            "SOUTH_AFRICA_ID_NUMBER",
            "US_STATE",
            "US_EMPLOYER_IDENTIFICATION_NUMBER",
            "GERMANY_PASSPORT",
            "AUSTRALIA_MEDICARE_NUMBER",
            "POLAND_PESEL_NUMBER",
            "SPAIN_NIE_NUMBER",
            "ITALY_PASSPORT",
            "US_HEALTHCARE_NPI",
            "CANADA_SOCIAL_INSURANCE_NUMBER",
            "FINLAND_NATIONAL_ID_NUMBER",
            "NETHERLANDS_BSN_NUMBER",
            "NEW_ZEALAND_NHI_NUMBER",
            "THAILAND_NATIONAL_ID_NUMBER",
            "AUSTRALIA_PASSPORT",
            "PERU_DNI_NUMBER",
            "COLOMBIA_CDC_NUMBER",
            "DENMARK_CPR_NUMBER",
            "SPAIN_SOCIAL_SECURITY_NUMBER",
            "SPAIN_DRIVERS_LICENSE_NUMBER",
            "GERMANY_SCHUFA_ID",
            "KOREA_RRN",
            "NEW_ZEALAND_IRD_NUMBER",
            "CANADA_OHIP",
            "FRANCE_NIR",
            "INDIA_GST_INDIVIDUAL",
            "JAPAN_INDIVIDUAL_NUMBER",
            "SPAIN_DNI_NUMBER",
            "INDIA_PAN_INDIVIDUAL",
            "IRELAND_PPSN",
            "ARMENIA_PASSPORT",
            "FRANCE_CNI",
            "AUSTRALIA_TAX_FILE_NUMBER",
            "UKRAINE_PASSPORT",
            "MEXICO_PASSPORT",
            "NETHERLANDS_PASSPORT",
            "CHINA_RESIDENT_ID_NUMBER",
            "CANADA_PASSPORT",
            "UZBEKISTAN_PASSPORT",
            "VENEZUELA_CDI_NUMBER",
            "PARAGUAY_CIC_NUMBER",
            "JAPAN_PASSPORT",
            "TAIWAN_PASSPORT",
            "UK_TAXPAYER_REFERENCE",
            "IRELAND_EIRCODE",
            "US_DEA_NUMBER",
            "PORTUGAL_CDC_NUMBER",
            "URUGUAY_CDI_NUMBER",
            "SPAIN_NIF_NUMBER",
            "GERMANY_IDENTITY_CARD_NUMBER",
            "ISRAEL_IDENTITY_CARD_NUMBER",
            "UK_NATIONAL_HEALTH_SERVICE_NUMBER",
            "SWEDEN_NATIONAL_ID_NUMBER",
            "FINANCIAL_ACCOUNT_NUMBER",
            "DOD_ID_NUMBER",
            "CHINA_PASSPORT",
            "SCOTLAND_COMMUNITY_HEALTH_INDEX_NUMBER",
            "US_INDIVIDUAL_TAXPAYER_IDENTIFICATION_NUMBER",
            "US_ADOPTION_TAXPAYER_IDENTIFICATION_NUMBER",
            "NORWAY_NI_NUMBER",
            "IRELAND_PASSPORT",
            "POLAND_NATIONAL_ID_NUMBER",
            "AZERBAIJAN_PASSPORT",
            "JAPAN_BANK_ACCOUNT",
            "FINANCIAL_ID",
            "VEHICLE_IDENTIFICATION_NUMBER",
            "MARITAL_STATUS",
            "IMMIGRATION_STATUS",
            "RELIGIOUS_TERM",
            "EMPLOYMENT_STATUS",
            "COUNTRY_DEMOGRAPHIC",
            "GEOGRAPHIC_DATA",
            "LOCATION_COORDINATES",
            "GENERIC_ID",
            "TECHNICAL_ID",
            "DOCUMENT_TYPE/FINANCE/REGULATORY",
            "POLAND_PASSPORT",
            "POLITICAL_TERM",
            "WEAK_PASSWORD_HASH",
            "XSRF_TOKEN",
            "DOMAIN_NAME",
            "US_TOLLFREE_PHONE_NUMBER",
            "IRELAND_PPSN",
            "PORTUGAL_NIB_NUMBER",
            "SINGAPORE_NATIONAL_REGISTRATION_ID_NUMBER",
            "PORTUGAL_SOCIAL_SECURITY_NUMBER",
            "UK_NATIONAL_INSURANCE_NUMBER",
            "AMERICAN_BANKERS_CUSIP_ID",
            "CHILE_CDI_NUMBER",
            "US_BANK_ROUTING_MICR",
            "KOREA_ARN",
            "SECURITY_DATA",
            "US_PREPARER_TAXPAYER_IDENTIFICATION_NUMBER",
            "US_VEHICLE_IDENTIFICATION_NUMBER",
            "FINANCIAL_ID",
            "ICCID_NUMBER",
            "MALE_NAME",
            "FEMALE_NAME",
            "ADVERTISING_ID",
        ]
    ]
    return all_types

def standardize_date(date_string):
    prompt = f"""Convert this date to YYYY-MM-DD format: {date_string}

Respond with ONLY the standardized date in YYYY-MM-DD format, nothing else.
If the date cannot be converted, respond with INVALID."""

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=prompt),
            ],
        ),
    ]

    generate_content_config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_level="MINIMAL",
        ),
    )

    try:
        response_text = ""
        for chunk in client.models.generate_content_stream(
            model=MODEL,
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.text:
                response_text += chunk.text

        response_text = response_text.strip()

        if not response_text or response_text == 'INVALID':
            raise ValueError("Invalid date format")
        return response_text
    except Exception as e:
        raise ValueError('Failed to standardize date') from None

def calculate_age(birth_date):
    today = datetime.now()
    birth_date = datetime.strptime(birth_date, "%Y-%m-%d")
    age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
    return age

def deidentify_content(project_id, text, identified_types=None):
    """Deidentify sensitive content using DLP API and Gemini for date processing."""
    if not text:
        return text


    # Get info types for redaction
    info_types = get_info_types()

    # Set up DLP API request for inspection
    inspect_config = {
        "info_types": info_types,
        "min_likelihood": dlp_v2.Likelihood.LIKELY,
        "include_quote": True,
    }

    # Use DLP to find all instances of sensitive information
    item = {"value": text}
    parent = f"projects/{project_id}"
    inspect_request = {
        "parent": parent,
        "inspect_config": inspect_config,
        "item": item,
    }

    inspect_response = dlp_client.inspect_content(request=inspect_request)

    # Process each finding
    for finding in inspect_response.result.findings:
        info_type = finding.info_type.name
        quote = finding.quote
        if identified_types is not None and info_type not in identified_types:
            identified_types.append(info_type)

        if info_type == "DATE_OF_BIRTH":
            try:
                standardized_date = standardize_date(quote)
                age = calculate_age(standardized_date)
                text = text.replace(quote, f"Age: {age}")
            except Exception as e:
                text = text.replace(quote, "[REDACTED DATE_OF_BIRTH]")

    # Set up DLP API request for deidentification of remaining sensitive information
    deidentify_config = {
        "info_type_transformations": {
            "transformations": [
                {
                    "primitive_transformation": {
                        "replace_config": {
                            "new_value": {
                                "string_value": "[REDACTED]"
                            }
                        }
                    }
                }
            ]
        }
    }

    deidentify_request = {
        "parent": parent,
        "deidentify_config": deidentify_config,
        "inspect_config": inspect_config,
        "item": {"value": text},
    }

    try:
        deidentify_response = dlp_client.deidentify_content(request=deidentify_request)
        
        return deidentify_response.item.value
    except Exception as e:
        return None  # Return None instead of raising an exception

@functions_framework.http
@protected_http
def redact_sensitive_info(request):
    """Redact content without returning or logging original identifying text."""
    try:
        text = request.get_json().get('text')
        if not isinstance(text, str) or not text.strip():
            return jsonify({'error': 'Text is required'}), 400
        if len(text) > runtime.positive_int('MAX_TEXT_CHARACTERS', 50000):
            return jsonify({'error': 'Text exceeds the configured limit'}), 400
        identified_types = []
        project_id = os.environ.get('DLP_PROJECT_ID', runtime.project_id())
        redacted_text = deidentify_content(project_id, text, identified_types)
        if redacted_text is None:
            return jsonify({'success': False, 'error': 'Failed to redact text'}), 502
        return jsonify({'success': True, 'redactedText': redacted_text,
                        'identifiedInfoTypes': identified_types}), 200
    except Exception:
        return jsonify({'error': 'Redaction is temporarily unavailable'}), 502


if __name__ == '__main__':
    app = functions_framework.create_app(target='redact_sensitive_info')
    app.run(host='127.0.0.1', port=8080)
