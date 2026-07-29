"""Fetches Specialty config from Firestore for the final-analysis persona.

Only `finalAnalysis.personaRole` is specialty-driven here -- the report
skeleton (tables, formatting rules) stays as fixed boilerplate shared across
all specialties. See docs/persona-system-plan.md at the repo root.
"""
import os

from google.cloud import firestore

DEFAULT_SPECIALTY_ID = "pediatric-oncology"


def get_specialty(specialty_id=None):
    specialty_id = specialty_id or DEFAULT_SPECIALTY_ID

    db = firestore.Client(
        project=os.environ.get('GENAI_PROJECT_ID') or os.environ.get('GOOGLE_CLOUD_PROJECT'),
        database=os.environ.get('DATABASE_ID', '(default)'),
    )
    doc = db.collection('specialties').document(specialty_id).get()
    if not doc.exists:
        raise ValueError(f"Specialty '{specialty_id}' not found in Firestore")

    return doc.to_dict()
