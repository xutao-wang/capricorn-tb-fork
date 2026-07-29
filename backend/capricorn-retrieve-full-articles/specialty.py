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


def build_article_scoring_prompt(specialty, disease, events_text, journal_context, article_text):
    persona_title = specialty['personaTitle']
    board_name = specialty.get('boardName')
    board_clause = f" and you are the chair of the {board_name}" if board_name else ""

    article_scoring = specialty['articleScoring']
    domain_field = article_scoring['domainFilterField']
    per_match_points = article_scoring['perMatchedEventPoints']
    fields = article_scoring['fields']

    disease_line = f"\nThe patient's disease is: {disease}\n" if disease else ""
    events_line = f"\nThe patient's actionable events are: {events_text}\n" if events_text else ""

    numbered_items = [
        "**Title:** The title of the paper. (0 Points)",
        "**Link:** A link to the paper. (0 Points)",
        "**Year:** Publication year (0 Points)",
        f"**{domain_field['label']}:** {domain_field['description']} (Boolean, true or false) "
        "(0 Points, but essential for filtering).",
    ]
    for field in fields:
        optional_note = " Omit this field entirely if not applicable to this article's domain." if field.get('optional') else ""
        numbered_items.append(
            f"**{field['label']}:** {field['description']} (Boolean true or false) "
            f"(if true, +{field['points']} points).{optional_note}"
        )
    numbered_items.append(
        "**Type of Cancer:** The specific type of cancer discussed "
        "(string, example: Leukemia (AML, ALL), Neuroblastoma, etc.)."
    )
    numbered_items.append(
        "**Paper Type:** The type of study (e.g., clinical trial, case report, in vitro study, "
        "review, retrospective study, biological rationale). (+40 points for clinical trial, "
        "-5 points for review)"
    )
    numbered_items.append(
        "**Actionable Event:** Any specific actionable event mentioned in the paper. Each event "
        "will be evaluated against the patient's extracted actionable events, and only matching "
        f"events will receive points ({per_match_points} points per matching event)"
    )
    numbered_items.append("**Overall Points:** Sum of all points based on the above criteria. (Calculated by the output).")

    numbered_list = "\n".join(f"{i + 1}. {item}" for i, item in enumerate(numbered_items))

    schema_field_lines = ",\n    ".join(f'"{f["key"]}": true/false' for f in fields)

    return f"""You are an expert {persona_title}{board_clause}. Your goal is to {article_scoring['evaluationGoal']}.{disease_line}{events_line}

Journal Impact Data (SJR scores):
The following is a list of journal titles and their SJR scores. When extracting the journal title from the article, find the best matching title from this list and use its SJR score. If no match is found, use 0 as the SJR score.

Journal Titles and Scores:
{journal_context}

<Article>
{article_text}
</Article>

<Instructions>
Your task is to read the provided full article and extract key information, and then assess the article's relevance and potential impact. You will generate a JSON object containing metadata and a point-based assessment of the article's value. Please use a consistent JSON structure.

As an expert {persona_title}:
1. Evaluate if the article's disease focus matches the patient's disease. Set disease_match to true if the article's cancer type is relevant to the patient's condition.
2. Analyze treatment outcomes. Set treatment_shown to true if the article demonstrates positive treatment results.
3. For each actionable event you find in the article, determine if it matches any of the patient's actionable events. For genetic mutations, create two separate events:
   - When you find a general mutation mention (e.g., if the article mentions just "NRAS" when patient has "NRAS (p.Gln61Lys)"), create an event with the general form and set matches_query=true
   - When you find an exact mutation match (e.g., if the article mentions "NRAS (p.Gln61Lys)" like it appears in the patient's events), create another event with the exact mutation and set matches_query=true

Here's the specific information to extract for each article and their points:

{numbered_list}

Please analyze the article and provide a JSON response with the following structure:

{{
  "article_metadata": {{
    "title": "...",
    "journal_title": "...",
    "journal_sjr": 0,
    "year": "...",
    "{domain_field['key']}": true/false,
    {schema_field_lines},
    "type_of_cancer": "...",
    "paper_type": "...",
    "actionable_events": [
      {{
        "event": "...",
        "matches_query": true/false
      }}
    ],
    "drug_results": ["...", "..."],
    "overall_points": 0
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
