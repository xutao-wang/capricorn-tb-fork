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
from flask import jsonify, request, Response
from google import genai
from google.genai import types
from google.cloud import bigquery
import json
import logging
import time
import math
import os
from datetime import datetime

from specialty import get_specialty, build_article_scoring_prompt, calculate_points

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global variable to store journal impact data
journal_impact_data = {}

def fetch_journal_impact_data():
    """Fetch journal impact data from BigQuery and store in memory."""
    global journal_impact_data
    project_id = os.environ.get('GENAI_PROJECT_ID', 'gemini-med-lit-review')
    journal_dataset = os.environ.get('JOURNAL_DATASET', 'journal_rank')
    query = f"""
    SELECT
      `title`,
      `sjr`
    FROM
      `{project_id}.{journal_dataset}.scimagojr_2024`
    ORDER BY
      sjr DESC
    """
    try:
        query_job = bq_client.query(query)
        results = query_job.result()

        # Convert to dictionary for faster lookups
        journal_impact_data = {row['title']: float(row['sjr']) for row in results}
        logger.info(f"Loaded {len(journal_impact_data)} journal impact records")
    except Exception as e:
        logger.error(f"Error fetching journal impact data: {str(e)}")

# Global variable to store citation data (NIH iCite: citation count + RCR,
# keyed by PMID). See docs/citation-scoring-plan.md at the repo root --
# this is a sampled subset (~8K PMIDs), not the full iCite dataset, so a
# lookup miss for an arbitrary retrieved article is expected and handled
# gracefully (contributes 0 points) rather than treated as an error.
citation_data = {}

def fetch_citation_data():
    """Fetch citation data from BigQuery and store in memory."""
    global citation_data
    project_id = os.environ.get('GENAI_PROJECT_ID', 'gemini-med-lit-review')
    citation_dataset = os.environ.get('CITATION_DATASET', 'citation_data')
    query = f"""
    SELECT
      `pmid`,
      `citation_count`,
      `relative_citation_ratio`
    FROM
      `{project_id}.{citation_dataset}.icite`
    """
    try:
        query_job = bq_client.query(query)
        results = query_job.result()

        citation_data = {
            row['pmid']: {
                'citation_count': row['citation_count'],
                'relative_citation_ratio': row['relative_citation_ratio']
            }
            for row in results
        }
        logger.info(f"Loaded {len(citation_data)} citation records")
    except Exception as e:
        logger.error(f"Error fetching citation data: {str(e)}")

# Initialize clients with environment variables
GCP_PROJECT = os.environ.get('GENAI_PROJECT_ID') or os.environ.get('GOOGLE_CLOUD_PROJECT') or 'gemini-med-lit-review'
GCP_LOCATION = os.environ.get('LOCATION', 'global')  # gemini-3.1-pro-preview requires 'global' region
MODEL = "gemini-3.1-pro-preview"

client = genai.Client(
    vertexai=True,
    project=GCP_PROJECT,
    location=GCP_LOCATION,
)
bq_client = bigquery.Client(project=os.environ.get('BIGQUERY_PROJECT_ID', GCP_PROJECT))

def analyze_with_gemini(article_text, pmcid, specialty, disease=None, events_text=None, weight_overrides=None, pmid=None):
    # Create journal context string
    journal_context = ""
    for title, sjr in journal_impact_data.items():
        journal_context += f"- {title}: {sjr}\n"

    prompt = build_article_scoring_prompt(specialty, disease, events_text, journal_context, article_text)
    prompt += "\n\nIMPORTANT: Return ONLY the raw JSON object. Do not include any explanatory text, markdown formatting, or code blocks. The response should start with '{' and end with '}' with no other characters before or after."
    
    # Configure Gemini with user's standard config pattern
    generate_content_config = types.GenerateContentConfig(
        temperature=1,
        top_p=0.95,
        max_output_tokens=65535,
        safety_settings=[
            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
        ],
        thinking_config=types.ThinkingConfig(
            thinking_level="HIGH",
        ),
    )
    
    # Create content with prompt
    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=prompt)],
        ),
    ]
    
    # Initialize retry parameters
    base_delay = 5  # Start with 5 seconds
    attempt = 0
    
    while True:  # Keep trying indefinitely
        try:
            # Use streaming to collect the response
            response_text = ""
            for chunk in client.models.generate_content_stream(
                model=MODEL,
                contents=contents,
                config=generate_content_config,
            ):
                if not chunk.candidates or not chunk.candidates[0].content or not chunk.candidates[0].content.parts:
                    continue
                if chunk.text:
                    response_text += chunk.text
            
            # Create a simple response object for compatibility with existing parsing
            class StreamedResponse:
                def __init__(self, text):
                    self.text = text
            response = StreamedResponse(response_text)
            break  # If successful, break out of the retry loop
        except Exception as e:
            error_str = str(e)
            if "429 RESOURCE_EXHAUSTED" in error_str:
                attempt += 1
                # Calculate exponential backoff delay with a maximum of 5 minutes
                delay = min(base_delay * (2 ** (attempt - 1)), 300)  # Cap at 300 seconds (5 minutes)
                logger.warning(f"Received RESOURCE_EXHAUSTED error. Attempt {attempt}. Waiting {delay} seconds before retry...")
                time.sleep(delay)
            else:
                # If it's not a 429 error, raise immediately
                raise
    
    try:
        # Log Gemini's raw response with clear markers
        logger.info("========== RAW GEMINI RESPONSE START ==========")
        logger.info(response.text)
        logger.info("========== RAW GEMINI RESPONSE END ============")
        
        # Clean up response text
        text = response.text.strip()
        
        # Try to find JSON object
        try:
            # First try to find JSON between ```json and ``` markers
            if '```json' in text:
                text = text.split('```json')[1].split('```')[0].strip()
            # If that fails, try to find JSON between { and }
            elif '{' in text and '}' in text:
                start = text.find('{')
                end = text.rfind('}') + 1
                text = text[start:end]
            
            # Remove any non-JSON text before or after
            text = text.strip()
            
            # Log cleaned text before parsing
            logger.info("========== CLEANED TEXT START ==========")
            logger.info(text)
            logger.info("========== CLEANED TEXT END ============")
            
            # Try to parse as JSON
            try:
                analysis = json.loads(text)
                logger.info("Successfully parsed JSON")
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error at position {e.pos}: {e.msg}")
                logger.error(f"Error context: {text[max(0, e.pos-50):min(len(text), e.pos+50)]}")
                raise
            
            # Validate required fields
            if not isinstance(analysis, dict) or 'article_metadata' not in analysis:
                logger.error("Invalid JSON structure - missing article_metadata")
                return None
                
            metadata = analysis['article_metadata']
            domain_field_key = specialty['articleScoring']['domainFilterField']['key']
            required_fields = ['title', 'journal_title', 'journal_sjr', domain_field_key, 'type_of_cancer', 'paper_type', 'actionable_events']
            for field in required_fields:
                if field not in metadata:
                    logger.error(f"Invalid JSON structure - missing {field}")
                    return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON: {str(e)}")
            logger.error(f"Cleaned response was: {text}")
            return None
        
        # Process metadata and calculate points
        if 'article_metadata' in analysis:
            metadata = analysis['article_metadata']
            # Add PMCID and generate link
            metadata['PMCID'] = pmcid
            metadata['link'] = f'https://www.ncbi.nlm.nih.gov/pmc/articles/{pmcid}/'
            
            # Calculate points with disease information
            citation_info = citation_data.get(str(pmid)) if pmid else None
            points, point_breakdown = calculate_points(specialty, metadata, disease, weight_overrides, citation_info)
            metadata['overall_points'] = points
            metadata['point_breakdown'] = point_breakdown
            
            # Store full article text at top level
            analysis['full_article_text'] = article_text
            logger.info("Added full article text and calculated points")
        
        return analysis
    except Exception as e:
        logger.error(f"Error analyzing article with Gemini: {str(e)}")
        return None

def create_bq_query(events_text, num_articles=15, disease=None):
    project_id = os.environ.get('BIGQUERY_PROJECT_ID', GCP_PROJECT)
    model_dataset = os.environ.get('MODEL_DATASET', 'model')
    # Use the new public PMC table
    pubmed_table = 'bigquery-public-data.pmc_open_access_commercial.articles'
    embedding_model = f'{project_id}.{model_dataset}.textembed'

    # Anchor the embedding query to the patient's disease so VECTOR_SEARCH returns
    # disease-relevant articles. Eval validation: 12% -> 100% disease relevance for
    # B-ALL case 1 with disease prepended; off-topic citations (Sezary syndrome,
    # NSCLC) eliminated; recommendations shifted to clinically appropriate
    # therapies (CAR-T, ADC). When disease is None, behavior is unchanged.
    query_body = f"{disease}\n\n{events_text}" if disease else events_text

    # The public PMC corpus has duplicate rows for ~113K PMCIDs (data quality
    # issue at ingestion -- see note to corpus maintainer). Without dedup,
    # VECTOR_SEARCH returns all duplicate rows and a user requesting
    # num_articles=3 can get the same article three times.
    # Strategy: over-fetch (5x or +20, capped at 500), dedupe by pmc_id keeping
    # the row with smallest distance (best similarity), then LIMIT to an
    # analysis pool bigger than what's actually displayed (see
    # docs/evidence-weighting-plan-v2.md). Vector search is cheap; the
    # expensive per-article Gemini analysis only runs on the deduped set.
    over_fetch = min(max(num_articles * 5, num_articles + 20), 500)

    # The doctor's weight_overrides only change scoring, not which
    # candidates come back from vector search -- unless we score a bigger
    # pool than we display and let the weighted score decide which ones
    # survive. 3x is a deliberate cost/quality tradeoff: bigger pools let
    # weights matter more (more candidates competing for the same slots)
    # but multiply Gemini analysis cost by the same factor, since every
    # pool candidate gets a full LLM read regardless of whether it makes
    # the final cut.
    analysis_pool_size = min(num_articles * 3, over_fetch)

    return f"""
    DECLARE query_text STRING;
    SET query_text = \"\"\"
    {query_body}
    \"\"\";

    WITH vector_results AS (
        SELECT base.pmc_id, base.pmid, base.article_text, distance
        FROM VECTOR_SEARCH(
            TABLE `{pubmed_table}`,
            'ml_generate_embedding_result',
            (SELECT ml_generate_embedding_result
             FROM ML.GENERATE_EMBEDDING(
                 MODEL `{embedding_model}`,
                 (SELECT query_text AS content)
             )),
            top_k => {over_fetch}
        )
    ),
    deduped AS (
        SELECT pmc_id, pmid, article_text, distance,
               ROW_NUMBER() OVER (PARTITION BY pmc_id ORDER BY distance) AS rn
        FROM vector_results
    )
    SELECT pmc_id, pmid, article_text, distance
    FROM deduped
    WHERE rn = 1
    ORDER BY distance
    LIMIT {analysis_pool_size}
    """

def stream_response(events_text, specialty, disease=None, num_articles=15, weight_overrides=None):
    try:
        # Execute BigQuery -- this now returns a larger analysis pool than
        # num_articles (see create_bq_query's analysis_pool_size), not just
        # the final displayed count.
        query = create_bq_query(events_text, num_articles, disease=disease)
        query_job = bq_client.query(query)
        results = list(query_job.result())
        pool_size = len(results)

        # Stream initial metadata. total_articles here reflects the pool
        # being screened, not the final display count, so the doctor's
        # progress indicator reflects the actual (larger) amount of work
        # happening before results appear.
        yield json.dumps({
            "type": "metadata",
            "data": {
                "total_articles": pool_size,
                "current_article": 0,
                "status": "processing"
            }
        }) + "\n"

        # Score every candidate in the pool -- buffered, not streamed as it
        # completes, since we don't know which candidates make the final
        # cut until every one has a weighted score. See
        # docs/evidence-weighting-plan-v2.md at the repo root.
        scored_articles = []
        for idx, row in enumerate(results, 1):
            pmcid = row['pmc_id']
            pmid = row['pmid']
            content = row['article_text']

            logger.info(f"Scoring candidate {idx}/{pool_size}: PMCID {pmcid}, content length: {len(content)}")

            if idx > 1:  # Don't delay before the first analysis
                logger.info("Waiting 5 seconds before next analysis...")
                time.sleep(5)

            try:
                analysis = analyze_with_gemini(content, pmcid, specialty, disease, events_text, weight_overrides, pmid)
                if analysis:
                    scored_articles.append(analysis)
                else:
                    logger.error(f"Failed to analyze article {pmcid}")
            except Exception as e:
                logger.error(f"Error processing article {pmcid}: {str(e)}")

        # Sort by the doctor's weighted score and keep only the requested
        # count -- this is the step that makes weight_overrides change
        # *which* articles the doctor sees, not just their display order.
        scored_articles.sort(key=lambda a: a['article_metadata']['overall_points'], reverse=True)
        top_articles = scored_articles[:num_articles]
        total_articles = len(top_articles)

        retrieved_pmcids = [a['article_metadata']['PMCID'] for a in top_articles]
        print(f"Selected top {total_articles} of {pool_size} scored candidates: {retrieved_pmcids}")

        yield json.dumps({
            "type": "pmcids",
            "data": {
                "pmcids": retrieved_pmcids
            }
        }) + "\n"

        for idx, analysis in enumerate(top_articles, 1):
            response_obj = {
                "type": "article_analysis",
                "data": {
                    "progress": {
                        "article_number": idx,
                        "total_articles": total_articles
                    },
                    "analysis": analysis
                }
            }
            yield json.dumps(response_obj) + "\n"

        # Send completion message as complete JSON object
        completion_obj = {
            "type": "metadata",
            "data": {
                "total_articles": total_articles,
                "current_article": total_articles,
                "status": "complete"
            }
        }
        yield json.dumps(completion_obj) + "\n"

    except Exception as e:
        logger.error(f"Error in stream_response: {str(e)}")
        yield json.dumps({
            "type": "error",
            "data": {
                "message": str(e)
            }
        }) + "\n"

# Fetch journal impact and citation data when module loads
fetch_journal_impact_data()
fetch_citation_data()

@functions_framework.http
def retrieve_full_articles(request):
    # Enable CORS
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    }

    try:
        request_json = request.get_json()
        if not request_json:
            return jsonify({'error': 'No JSON data received'}), 400, headers

        events_text = request_json.get('events_text')
        if not events_text:
            return jsonify({'error': 'Missing events_text field'}), 400, headers

        # Get specialty, disease, and num_articles if provided
        specialty = get_specialty(request_json.get('specialtyId'))
        print(f"Using specialty: {specialty['id']}")
        disease = request_json.get('disease')
        num_articles = request_json.get('num_articles', 15)  # Default to 15 if not provided
        weight_overrides = request_json.get('weightOverrides')

        return Response(
            stream_response(events_text, specialty, disease, num_articles, weight_overrides),
            headers=headers,
            mimetype='text/event-stream'
        )

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return jsonify({"error": str(e)}), 500, headers

if __name__ == "__main__":
    app = functions_framework.create_app(target="retrieve_full_articles")
    app.run(host="0.0.0.0", port=8080, debug=True)
