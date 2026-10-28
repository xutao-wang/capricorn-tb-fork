#!/usr/bin/env python3
"""
Seeds the `specialties` Firestore collection from the JSON files in this directory.
Usage: python seed_firestore.py --project-id PROJECT_ID --database-id DATABASE_ID
"""
import argparse
import json
import os

from google.cloud import firestore
from google.api_core.exceptions import AlreadyExists


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--database-id', required=True)
    args = parser.parse_args()

    db = firestore.Client(project=args.project_id, database=args.database_id)

    here = os.path.dirname(os.path.abspath(__file__))
    for filename in os.listdir(here):
        if not filename.endswith('.json'):
            continue
        with open(os.path.join(here, filename)) as f:
            specialty = json.load(f)

        specialty_id = specialty['id']
        try:
            db.collection('specialties').document(specialty_id).create(specialty)
            print(f"Seeded specialties/{specialty_id} from {filename}")
        except AlreadyExists:
            print(f"Preserved existing specialties/{specialty_id}")


if __name__ == '__main__':
    main()
