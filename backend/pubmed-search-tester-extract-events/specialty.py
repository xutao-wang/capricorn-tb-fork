"""Fetches Specialty config from Firestore and assembles the event-extraction prompt.

See docs/persona-system-plan.md at the repo root for the full schema and design.
"""
import os
from capricorn_runtime import config as runtime

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
        project=runtime.project_id(),
        database=runtime.database_id(),
    )
    doc = db.collection('specialties').document(specialty_id).get()
    if not doc.exists:
        raise ValueError(f"Specialty '{specialty_id}' not found in Firestore")

    return doc.to_dict()


def _indent(block, spaces=4):
    prefix = " " * spaces
    return "\n".join(prefix + line for line in block.split("\n"))


def build_event_extraction_prompt(specialty):
    max_events = runtime.positive_int('MAX_EVENTS', 10)
    persona_title = specialty['personaTitle']
    board_name = specialty.get('boardName')
    board_clause = f" and chair of the {board_name}" if board_name else ""

    event_extraction = specialty['eventExtraction']

    category_blocks = "\n\n".join(
        _indent(cat['block']) for cat in event_extraction['categories']
    )

    post_category_notes = "\n".join(
        f"  *  {note}" for note in event_extraction.get('postCategoryNotes', [])
    )

    example = event_extraction.get('fewShotExample')
    example_section = ""
    if example:
        example_section = f"""**Example:**

*  **Case Note Input:** "{example['caseNoteInput']}"

**Output:**
{example['expectedOutput']}

"""

    guidance_notes = "\n".join(
        f"*  {note}" for note in event_extraction.get('guidanceNotes', [])
    )
    guidance_section = f"""**Reasoning and Guidance:**

{guidance_notes}

""" if guidance_notes else ""

    return f"""You are an expert {persona_title}{board_clause}. Your role is to analyze complex patient case notes, identify key actionable events that may guide treatment strategies, and formulate precise search queries for PubMed to retrieve relevant clinical research articles.

**Input:** Patient case notes, as provided by a clinician. This will include information on diagnosis, treatment history, and relevant diagnostic findings including genetics and flow cytometry results.

**Task:**

1. **Actionable Event Extraction:**
  *  Carefully analyze the patient case notes.
  *  {event_extraction['categoryIntro']}

{category_blocks}

{post_category_notes}

{example_section}{guidance_section}Extract actionable events from the provided patient information. Return only a JSON array containing at most {max_events} distinct, concise strings (each no longer than 240 characters), with no markdown or other formatting. If more findings are available, prioritize the most relevant reviewed imaging phenotypes, explicit microbiology and drug-resistance results, and major clinical modifiers for literature search. Combine closely related findings where appropriate, preserving locations, drug names and mutations. Do not invent findings or infer clinical facts from imaging alone. If no actionable findings are supplied, return an empty array."""
