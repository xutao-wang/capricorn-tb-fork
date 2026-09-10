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
journal_impact_lookup = {}

def fetch_journal_impact_data():
    """Fetch journal impact data from BigQuery and store in memory."""
    global journal_impact_data, journal_impact_lookup
    project_id = os.environ.get('GENAI_PROJECT_ID') or os.environ.get('GOOGLE_CLOUD_PROJECT') or 'onboarding-sandbox-477121'
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
        journal_impact_lookup = {title.strip().lower(): float(sjr) for title, sjr in journal_impact_data.items()}
        logger.info(f"Loaded {len(journal_impact_data)} journal impact records")
    except Exception as e:
        logger.error(f"Error fetching journal impact data: {str(e)}")

def lookup_journal_sjr(journal_title):
    """Fast in-memory SJR lookup without prompt injection."""
    if not journal_title:
        return 0.0
    jt = journal_title.strip().lower()
    if jt in journal_impact_lookup:
        return journal_impact_lookup[jt]
    if jt.startswith('the '):
        jt_sub = jt[4:].strip()
        if jt_sub in journal_impact_lookup:
            return journal_impact_lookup[jt_sub]
    return 0.0

# Global variable to store citation data (NIH iCite: citation count + RCR,
# keyed by PMID). See docs/citation-scoring-plan.md at the repo root --
# this is a sampled subset (~8K PMIDs), not the full iCite dataset, so a
# lookup miss for an arbitrary retrieved article is expected and handled
# gracefully (contributes 0 points) rather than treated as an error.
citation_data = {}

def fetch_citation_data():
    """Fetch citation data from BigQuery and store in memory."""
    global citation_data
    project_id = os.environ.get('GENAI_PROJECT_ID') or os.environ.get('GOOGLE_CLOUD_PROJECT') or 'onboarding-sandbox-477121'
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
GCP_PROJECT = os.environ.get('GENAI_PROJECT_ID') or os.environ.get('GOOGLE_CLOUD_PROJECT') or 'onboarding-sandbox-477121'
GCP_LOCATION = os.environ.get('LOCATION', 'global')
MODEL = "gemini-2.5-flash"

client = genai.Client(
    vertexai=True,
    project=GCP_PROJECT,
    location=GCP_LOCATION,
)
bq_client = bigquery.Client(project=os.environ.get('BIGQUERY_PROJECT_ID', GCP_PROJECT))

def analyze_with_gemini(article_text, pmcid, specialty, disease=None, events_text=None, weight_overrides=None, pmid=None):
    prompt = build_article_scoring_prompt(specialty, disease, events_text, article_text)
    prompt += "\n\nIMPORTANT: Return ONLY the raw JSON object. Do not include any explanatory text, markdown formatting, or code blocks."
    
    # Fast, structured JSON extraction with Gemini 2.5 Flash
    generate_content_config = types.GenerateContentConfig(
        temperature=0.1,
        top_p=0.95,
        max_output_tokens=4096,
        response_mime_type="application/json",
        safety_settings=[
            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
        ],
    )
    
    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=prompt)],
        ),
    ]
    
    base_delay = 2
    attempt = 0
    max_attempts = 3
    response_text = ""
    
    while attempt < max_attempts:
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=contents,
                config=generate_content_config,
            )
            response_text = response.text or ""
            break
        except Exception as e:
            attempt += 1
            if "429" in str(e) and attempt < max_attempts:
                delay = base_delay * attempt
                logger.warning(f"Rate limit encountered for {pmcid}. Waiting {delay}s before retry...")
                time.sleep(delay)
            else:
                logger.error(f"Gemini error analyzing {pmcid}: {str(e)}")
                return None
    
    try:
        text = response_text.strip()
        if text.startswith('```json'):
            text = text.split('```json')[1].split('```')[0].strip()
        elif text.startswith('```'):
            text = text.split('```')[1].split('```')[0].strip()
        elif '{' in text and '}' in text:
            start = text.find('{')
            end = text.rfind('}') + 1
            text = text[start:end]
            
        analysis = json.loads(text)
        if not isinstance(analysis, dict) or 'article_metadata' not in analysis:
            logger.error(f"Invalid JSON structure for {pmcid} - missing article_metadata")
            return None
            
        metadata = analysis['article_metadata']
        domain_field_key = specialty['articleScoring']['domainFilterField']['key']

        # Ensure required fields exist with fallbacks
        if not metadata.get('title'):
            metadata['title'] = f"Article {pmcid}"
        if not metadata.get('journal_title'):
            metadata['journal_title'] = "Unknown Journal"

        # Deterministic O(1) BigQuery SJR lookup
        metadata['journal_sjr'] = lookup_journal_sjr(metadata.get('journal_title', ''))

        # Standardize condition/cancer field
        condition = metadata.get('condition') or metadata.get('type_of_cancer') or metadata.get('disease') or disease or ''
        metadata['type_of_cancer'] = condition
        metadata['condition'] = condition

        # Ensure paper_type and actionable_events
        if 'paper_type' not in metadata:
            metadata['paper_type'] = 'Research Article'
        if 'actionable_events' not in metadata or not isinstance(metadata['actionable_events'], list):
            metadata['actionable_events'] = []

        # Domain field fallback
        if domain_field_key not in metadata:
            metadata[domain_field_key] = True
        
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
        return analysis
    except Exception as e:
        logger.error(f"Error parsing article {pmcid}: {str(e)}")
        return None

def create_bq_query(events_text, num_articles=15, disease=None):
    project_id = os.environ.get('BIGQUERY_PROJECT_ID', GCP_PROJECT)
    model_dataset = os.environ.get('MODEL_DATASET', 'model')
    pubmed_table = 'bigquery-public-data.pmc_open_access_commercial.articles'
    embedding_model = f'{project_id}.{model_dataset}.textembed'

    query_body = f"{disease}\n\n{events_text}" if disease else events_text
    over_fetch = min(max(num_articles * 5, num_articles + 20), 500)
    # Target pool size: for 15 articles, score ~21 candidates for high relevance and low latency
    analysis_pool_size = min(max(num_articles, int(num_articles * 1.4)), 25)

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
        query = create_bq_query(events_text, num_articles, disease=disease)
        query_job = bq_client.query(query)
        results = list(query_job.result())
        pool_size = len(results)

        # Stream initial metadata
        yield json.dumps({
            "type": "metadata",
            "data": {
                "total_articles": pool_size,
                "current_article": 0,
                "status": "processing"
            }
        }) + "\n"

        scored_articles = []
        for idx, row in enumerate(results, 1):
            pmcid = row['pmc_id']
            pmid = row['pmid']
            content = row['article_text']

            logger.info(f"Scoring candidate {idx}/{pool_size}: PMCID {pmcid}, content length: {len(content)}")

            # Stream progress update to keep connection active and inform the user
            yield json.dumps({
                "type": "metadata",
                "data": {
                    "total_articles": pool_size,
                    "current_article": idx,
                    "status": "processing"
                }
            }) + "\n"

            try:
                analysis = analyze_with_gemini(content, pmcid, specialty, disease, events_text, weight_overrides, pmid)
                if analysis:
                    scored_articles.append(analysis)
                else:
                    logger.warning(f"Failed to analyze article {pmcid}")
            except Exception as e:
                logger.error(f"Error processing article {pmcid}: {str(e)}")

        # Sort by weighted score and retain top requested articles
        scored_articles.sort(key=lambda a: a['article_metadata']['overall_points'], reverse=True)
        top_articles = scored_articles[:num_articles]
        total_articles = len(top_articles)

        retrieved_pmcids = [a['article_metadata']['PMCID'] for a in top_articles]
        logger.info(f"Selected top {total_articles} of {len(scored_articles)} scored candidates: {retrieved_pmcids}")

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
