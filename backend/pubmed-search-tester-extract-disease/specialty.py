"""Fetches Specialty config from Firestore and assembles the disease-extraction prompt.

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
        project=os.environ.get('PROJECT_ID'),
        database=os.environ.get('DATABASE_ID', '(default)'),
    )
    doc = db.collection('specialties').document(specialty_id).get()
    if not doc.exists:
        raise ValueError(f"Specialty '{specialty_id}' not found in Firestore")

    return doc.to_dict()


def build_disease_extraction_prompt(specialty):
    persona_title = specialty['personaTitle']
    board_name = specialty.get('boardName')
    board_clause = f" and chair of the {board_name}" if board_name else ""

    examples = specialty['diseaseExtraction'].get('fewShotExamples', [])
    examples_text = "\n\n".join(
        f'Case Note Input: "{ex["input"]}"\n\nOutput: {ex["output"]}'
        for ex in examples
    )
    example_section = f"""Example:

{examples_text}

""" if examples else ""

    guidance = specialty['diseaseExtraction'].get('guidance')
    guidance_clause = f"\n\n{guidance}" if guidance else ""

    return f"""You are an expert {persona_title}{board_clause}. Your role is to analyze patient case notes and identify the primary disease being discussed.

Input: Patient case notes, as provided by a clinician. This will include information on diagnosis, treatment history, and relevant diagnostic findings.

Task:

Disease Extraction:

Carefully analyze the patient case notes.

Identify the primary disease the patient is diagnosed with and/or being treated for. Extract this disease name exactly as it is written in the notes. It should be the initial diagnosis.{guidance_clause}

{example_section}Extract the disease from the provided patient information. Only output the disease name, exactly as it is written in the case notes. Do not include any other text or formatting.

Case notes:
"""
