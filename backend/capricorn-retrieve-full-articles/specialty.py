"""Fetches Specialty config from Firestore and assembles the article-scoring
prompt + drives the point calculation for retrieve-full-articles.

Unlike the disease/event extraction prompts (which are transcribed verbatim
from the original hardcoded text), this prompt is *generated* from
`articleScoring.fields` rather than string-matched against the old prose.
That's intentional: the old prose already drifted from the real scoring
code (e.g. it claimed a `type_of_cancer` exact-match bonus that
calculate_points() never applied, and never mentioned the journal-impact /
publication-year scoring that calculate_points() does apply). This module
makes `articleScoring.fields` the single source of truth for both the
prompt text shown to the model and the point weights applied in Python,
so the two can no longer diverge.

See docs/persona-system-plan.md at the repo root for the full schema and design.
"""
import os

from google.cloud import firestore

DEFAULT_SPECIALTY_ID = "pediatric-oncology"


def get_specialty(specialty_id=None):
    """Fetches the specialty doc fresh on every call (no caching) so that edits
    to a specialty in Firestore take effect immediately, without requiring a
    redeploy to clear a stale in-memory cache on warm Cloud Function instances.
    This is called once per HTTP request, not per-article, so the extra
    Firestore read is negligible."""
    specialty_id = specialty_id or DEFAULT_SPECIALTY_ID

    db = firestore.Client(
        project=os.environ.get('GENAI_PROJECT_ID') or os.environ.get('GOOGLE_CLOUD_PROJECT'),
        database=os.environ.get('DATABASE_ID', '(default)'),
    )
    doc = db.collection('specialties').document(specialty_id).get()
    if not doc.exists:
        raise ValueError(f"Specialty '{specialty_id}' not found in Firestore")

    return doc.to_dict()


def build_article_scoring_prompt(specialty, disease, events_text, article_text, journal_context=None):
    persona_title = specialty['personaTitle']
    board_name = specialty.get('boardName')
    board_clause = f" and you are the chair of the {board_name}" if board_name else ""

    article_scoring = specialty['articleScoring']
    domain_field = article_scoring['domainFilterField']
    per_match_points = article_scoring['perMatchedEventPoints']
    fields = article_scoring['fields']

    disease_line = f"\nThe patient's disease/condition is: {disease}\n" if disease else ""
    events_line = f"\nThe patient's actionable events are: {events_text}\n" if events_text else ""

    numbered_items = [
        "**Title:** The title of the paper.",
        "**Journal Title:** The publishing journal name.",
        "**Year:** Publication year (e.g. '2023').",
        f"**{domain_field['label']}:** {domain_field['description']} (Boolean, true or false).",
    ]
    for field in fields:
        optional_note = " Omit this field entirely if not applicable to this article's domain." if field.get('optional') else ""
        numbered_items.append(
            f"**{field['label']}:** {field['description']} (Boolean true or false).{optional_note}"
        )
    numbered_items.append(
        "**Condition / Disease:** The specific condition, cancer type, or infectious disease discussed (string, e.g. 'Tuberculosis', 'Multidrug-Resistant Tuberculosis', 'AML', etc.)."
    )
    numbered_items.append(
        "**Paper Type:** The type of study (e.g., clinical trial, case report, in vitro study, review, retrospective study, biological rationale)."
    )
    numbered_items.append(
        "**Actionable Events:** Specific clinical, imaging, microbiological, resistance, or genomic events mentioned in the paper and whether they match the patient's events (array of objects with 'event' and 'matches_query')."
    )

    numbered_list = "\n".join(f"{i + 1}. {item}" for i, item in enumerate(numbered_items))

    schema_field_lines = ",\n    ".join(f'"{f["key"]}": true/false' for f in fields)

    return f"""You are an expert {persona_title}{board_clause}. Your goal is to {article_scoring['evaluationGoal']}.{disease_line}{events_line}

<Article>
{article_text}
</Article>

<Instructions>
Your task is to read the provided full article and extract key information to assess the article's clinical relevance and potential impact. You will generate a JSON object containing structured metadata.

As an expert {persona_title}:
1. Evaluate if the article's disease/condition focus matches the patient's condition ({disease or 'the evaluated pathology'}). Set disease_match to true if the article is relevant to the patient's condition.
2. Analyze treatment outcomes. Set treatment_shown to true if the article demonstrates positive treatment results.
3. For each actionable event you find in the article, determine if it matches any of the patient's actionable events:
   - When you find a general match (e.g., mentioning the general drug class, resistance, or radiographic sign), create an event with the general form and set matches_query=true
   - When you find an exact match (e.g., specific mutation, specific regimen, or specific imaging phenotype matching the patient's events), create an event with the exact match and set matches_query=true

Here's the specific information to extract for each article:

{numbered_list}

Please analyze the article and provide a JSON response with the following structure:

{{
  "article_metadata": {{
    "title": "...",
    "journal_title": "...",
    "year": "...",
    "{domain_field['key']}": true/false,
    {schema_field_lines},
    "condition": "...",
    "type_of_cancer": "...",
    "paper_type": "...",
    "actionable_events": [
      {{
        "event": "...",
        "matches_query": true/false
      }}
    ],
    "drugs_tested": true/false,
    "drug_results": ["...", "..."]
  }}
}}

Important: The response must be valid JSON and follow this exact structure. Do not include any explanatory text, markdown formatting, or code blocks. Return only the raw JSON object."""


def calculate_points(specialty, metadata, query_disease=None, weight_overrides=None, citation_info=None):
    """Calculate points based on article metadata. Every factor is driven by
    the specialty's articleScoring config (the single source of truth shared
    with the prompt above), with an optional per-request weight_overrides
    dict (flat {factorKey: number}) letting a doctor override any single
    factor's weight for this request without touching the specialty's
    stored defaults. See docs/evidence-weighting-plan-v1.md at the repo root.

    citation_info, if provided, is a {citation_count, relative_citation_ratio}
    dict looked up by PMID from a sampled NIH iCite dataset (see
    docs/citation-scoring-plan.md) -- unlike every other factor here, this is
    a pure Python lookup, not something Gemini reports, since PMID is an
    exact identifier we already have rather than a fuzzy text match like
    journal title. A lookup miss (citation_info=None) contributes 0 points,
    the same as any other specialty not covered by the sampled dataset."""
    import math
    from datetime import datetime

    overrides = weight_overrides or {}
    scoring = specialty['articleScoring']

    def weight(key, default):
        return overrides.get(key, default)

    points = 0
    breakdown = {}

    if metadata.get('journal_title') and metadata.get('journal_sjr'):
        sjr = float(metadata['journal_sjr'])
        if sjr > 0:
            multiplier = weight('journalImpactMultiplier', scoring.get('journalImpactMultiplier', 5))
            cap = weight('journalImpactCap', scoring.get('journalImpactCap', 25))
            impact_points = min(math.log(sjr + 1) * multiplier, cap)
            points += impact_points
            breakdown['journal_impact'] = impact_points

    if citation_info and citation_info.get('relative_citation_ratio'):
        rcr = float(citation_info['relative_citation_ratio'])
        if rcr > 0:
            citation_multiplier = weight('citationImpactMultiplier', scoring.get('citationImpactMultiplier', 5))
            citation_cap = weight('citationImpactCap', scoring.get('citationImpactCap', 25))
            citation_points = min(math.log(rcr + 1) * citation_multiplier, citation_cap)
            points += citation_points
            breakdown['citation_impact'] = citation_points

    current_year = datetime.now().year
    if metadata.get('year'):
        try:
            article_year = int(metadata.get('year'))
            decay_rate = weight('yearDecayRate', scoring.get('yearDecayRate', 5))
            year_points = -decay_rate * (current_year - article_year)
            points += year_points
            breakdown['year'] = year_points
        except (ValueError, TypeError):
            pass

    for field in scoring['fields']:
        if metadata.get(field['key']):
            field_points = weight(field['key'], field['points'])
            points += field_points
            breakdown[field['key']] = field_points

    paper_type = (metadata.get('paper_type') or '').lower()
    if 'clinical trial' in paper_type:
        bonus = weight('clinicalTrialBonus', scoring.get('clinicalTrialBonus', 40))
        points += bonus
        breakdown['paper_type'] = bonus
    elif 'review' in paper_type:
        penalty = weight('reviewPenalty', scoring.get('reviewPenalty', 5))
        points -= penalty
        breakdown['paper_type'] = -penalty

    actionable_events = metadata.get('actionable_events', [])
    matched_events = sum(1 for event in actionable_events if event.get('matches_query', False))
    if matched_events > 0:
        per_event = weight('perMatchedEventPoints', scoring['perMatchedEventPoints'])
        event_points = matched_events * per_event
        points += event_points
        breakdown['actionable_events'] = event_points

    return points, breakdown
