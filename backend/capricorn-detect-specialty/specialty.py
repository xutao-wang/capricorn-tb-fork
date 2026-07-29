"""Fetches all Specialty configs from Firestore for the specialty-detection classifier,
and generates + persists a new specialty config when a case doesn't fit any existing one.

Unlike every other function's specialty.py (which fetches a single doc by
id), this one lists the whole `specialties` collection, since the point of
detection is choosing among all of them. See docs/auto-specialty-detection-plan.md
and docs/persona-generation-plan.md at the repo root for the full design.
"""
import os
import re

from google.cloud import firestore

DEFAULT_SPECIALTY_ID = "general-medicine"
CONFIDENCE_THRESHOLD = 65

# Every top-level field a specialty doc must have for the rest of the
# pipeline (disease/event extraction, article scoring, final analysis) to
# work without KeyErrors. Mirrors the hand-authored JSONs in
# backend/specialties/.
REQUIRED_TOP_LEVEL_FIELDS = [
    'id', 'label', 'description', 'personaTitle', 'boardName',
    'diseaseExtraction', 'eventExtraction', 'articleScoring',
    'finalAnalysis', 'chatContextLabel',
]
REQUIRED_ARTICLE_SCORING_FIELDS = [
    'evaluationGoal', 'domainFilterField', 'perMatchedEventPoints',
    'journalImpactMultiplier', 'journalImpactCap', 'yearDecayRate',
    'clinicalTrialBonus', 'reviewPenalty', 'citationImpactMultiplier',
    'citationImpactCap', 'fields',
]


def _db():
    return firestore.Client(
        project=os.environ.get('PROJECT_ID'),
        database=os.environ.get('DATABASE_ID', '(default)'),
    )


def list_specialties():
    docs = _db().collection('specialties').stream()
    specialties = [doc.to_dict() for doc in docs]
    if not specialties:
        raise ValueError("No specialties found in Firestore")
    return specialties


def build_detection_prompt(specialties, case_text):
    specialty_list = "\n".join(
        f'- {s["id"]}: {s["description"]}' for s in specialties
    )

    return f"""You are a medical triage assistant. Your job is to determine which medical specialty is best suited to analyze the following patient case.

Available specialties:
{specialty_list}

Patient case notes:
\"\"\"
{case_text}
\"\"\"

Task: Choose the single best-matching specialty id from the list above, and rate your confidence (0-100) that it's a genuinely good fit -- not just the least-bad option. If none of the available specialties are a good fit for this case's disease/organ system, set specialtyId to null and instead suggest a new specialty via suggestedLabel/suggestedDescription (a short label like "Hepatology" and a one-sentence description of what it covers, in the same style as the descriptions above). Do not choose "{DEFAULT_SPECIALTY_ID}" out of caution if a more specific new specialty would genuinely fit better -- only fall back to null/suggestion when the case doesn't fit any existing option well.

Return ONLY a raw JSON object with this exact structure. Do not include any explanatory text, markdown formatting, or code blocks. The response should start with '{{' and end with '}}' with no other characters before or after.
{{
  "specialtyId": "..." or null,
  "confidence": 0-100,
  "rationale": "One sentence explaining the choice.",
  "suggestedLabel": "..." or null,
  "suggestedDescription": "..." or null
}}"""


def build_persona_generation_prompt(existing_specialties, case_text, suggested_label, suggested_description):
    """Builds a prompt that generates a full specialty config JSON, using the
    existing hand-authored specialties as few-shot examples so the generated
    doc matches their structure (same field types, similar point-value
    ranges) rather than inventing a different shape."""
    import json
    examples = "\n\n".join(
        f"Example specialty ({s['id']}):\n{json.dumps(s, indent=2)}"
        for s in existing_specialties[:2]
    )

    return f"""You are designing a new medical specialty persona configuration for a clinical literature-retrieval system. A patient case did not fit any existing specialty well, and a new one is needed: "{suggested_label}" -- {suggested_description}.

Here are examples of the existing configuration format:

{examples}

Patient case notes that triggered this (for context on what kind of terminology/events this specialty should extract):
\"\"\"
{case_text}
\"\"\"

Task: Generate a complete specialty configuration JSON for "{suggested_label}", following the EXACT same structure as the examples above:
- id: a lowercase-hyphenated slug derived from the label (e.g. "hepatology")
- label, description: matching the suggested label/description
- personaTitle: the type of physician who would review this (e.g. "hepatologist")
- boardName: null (only the original pediatric-oncology specialty uses a real named tumor board; do not invent one for this specialty)
- diseaseExtraction: guidance (null is fine) + 2-3 fewShotExamples (input/output pairs) for extracting the disease name from case notes in this specialty
- eventExtraction: categoryIntro, 3-5 categories (name + block) relevant to this specialty's actionable clinical events, postCategoryNotes, one fewShotExample (caseNoteInput/expectedOutput), guidanceNotes
- articleScoring: evaluationGoal, domainFilterField (key/label/description), perMatchedEventPoints, journalImpactMultiplier, journalImpactCap, yearDecayRate, clinicalTrialBonus, reviewPenalty, citationImpactMultiplier, citationImpactCap, and a fields array (each with key/label/points/description/optional) covering the factors relevant to scoring literature for this specialty -- use point values in the same ranges as the examples (5-50)
- finalAnalysis: personaRole
- chatContextLabel: a short label like "hepatology case"

Return ONLY the raw JSON object for the new specialty. Do not include any explanatory text, markdown formatting, or code blocks."""


def validate_specialty_config(config):
    """Returns (is_valid, error_message). Mirrors the required-field checks
    the rest of the pipeline depends on (see analyze_with_gemini's
    required_fields check in capricorn-retrieve-full-articles/main.py)."""
    if not isinstance(config, dict):
        return False, "Generated config is not a JSON object"

    for field in REQUIRED_TOP_LEVEL_FIELDS:
        if field not in config:
            return False, f"Missing top-level field: {field}"

    scoring = config.get('articleScoring')
    if not isinstance(scoring, dict):
        return False, "articleScoring is not an object"
    for field in REQUIRED_ARTICLE_SCORING_FIELDS:
        if field not in scoring:
            return False, f"Missing articleScoring field: {field}"

    domain_field = scoring.get('domainFilterField')
    if not isinstance(domain_field, dict) or 'key' not in domain_field:
        return False, "articleScoring.domainFilterField is missing or malformed"

    fields = scoring.get('fields')
    if not isinstance(fields, list) or not fields:
        return False, "articleScoring.fields must be a non-empty list"
    for f in fields:
        if not all(k in f for k in ('key', 'label', 'points', 'description')):
            return False, f"Malformed field entry in articleScoring.fields: {f}"

    return True, None


def slugify(label):
    slug = re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')
    return slug or 'specialty'


def unique_specialty_id(label, existing_ids):
    base = slugify(label)
    if base not in existing_ids:
        return base
    suffix = 2
    while f"{base}-{suffix}" in existing_ids:
        suffix += 1
    return f"{base}-{suffix}"


def save_generated_specialty(config, source_case_excerpt):
    """Persists a newly generated specialty via the function's Admin SDK
    credentials (this bypasses client-facing Firestore security rules,
    which is correct -- this is a server-generated doc, not a doctor
    manually creating one). Tagged as generated + pending review so the
    frontend can surface an "unreviewed" warning rather than presenting it
    identically to the hand-curated personas. See docs/persona-generation-plan.md."""
    config['generated'] = True
    config['reviewStatus'] = 'pending'
    config['generatedFromCaseExcerpt'] = source_case_excerpt[:500]
    config['createdAt'] = firestore.SERVER_TIMESTAMP

    db = _db()
    db.collection('specialties').document(config['id']).set(config)
    return config
