#!/usr/bin/env python3
"""
Script to load NIH iCite citation data (citation count + Relative Citation
Ratio, keyed by PMID) into BigQuery. Mirrors load_journal_data_to_bq.py's
pattern exactly -- same ETL shape, different source file, keyed by PMID
instead of journal title. See docs/citation-scoring-plan.md at the repo
root and fetch_icite_sample.py, which produces the input CSV this script
expects.
"""
import csv
import os
import sys
from google.cloud import bigquery
import argparse


def process_citation_csv(csv_file_path):
    """Process the iCite CSV file (pmid, citation_count, relative_citation_ratio)"""
    citations = []

    with open(csv_file_path, 'r', encoding='utf-8') as file:
        csv_reader = csv.DictReader(file)

        for row in csv_reader:
            pmid = row['pmid'].strip()
            try:
                citation_count = int(row['citation_count'])
            except ValueError:
                citation_count = 0
            try:
                rcr = float(row['relative_citation_ratio'])
            except ValueError:
                rcr = 0.0

            citations.append({
                'pmid': pmid,
                'citation_count': citation_count,
                'relative_citation_ratio': rcr
            })

    return citations


def create_bigquery_table(project_id, dataset_id, table_id):
    """Create BigQuery table with the appropriate schema"""
    client = bigquery.Client(project=project_id)

    schema = [
        bigquery.SchemaField("pmid", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("citation_count", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("relative_citation_ratio", "FLOAT64", mode="REQUIRED"),
    ]

    table_ref = f"{project_id}.{dataset_id}.{table_id}"
    table = bigquery.Table(table_ref, schema=schema)

    table = client.create_table(table, exists_ok=True)
    print(f"Ensured table {table_ref}; existing data is preserved")

    return table_ref


def load_data_to_bigquery(project_id, dataset_id, table_id, citation_data):
    """Load citation data into BigQuery"""
    client = bigquery.Client(project=project_id)

    table_ref = f"{project_id}.{dataset_id}.{table_id}"

    job_config = bigquery.LoadJobConfig(
        schema=[
            bigquery.SchemaField("pmid", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("citation_count", "INT64", mode="REQUIRED"),
            bigquery.SchemaField("relative_citation_ratio", "FLOAT64", mode="REQUIRED"),
        ],
        write_disposition="WRITE_EMPTY",
    )

    job = client.load_table_from_json(citation_data, table_ref, job_config=job_config)
    job.result()

    table = client.get_table(table_ref)
    print(f"Loaded {table.num_rows} rows into {table_ref}")


def main():
    parser = argparse.ArgumentParser(description='Load NIH iCite citation data into BigQuery')
    parser.add_argument('--project-id', required=True, help='GCP Project ID')
    parser.add_argument('--dataset-id', default='citation_data', help='BigQuery Dataset ID (default: citation_data)')
    parser.add_argument('--table-id', default='icite', help='BigQuery Table ID (default: icite)')
    parser.add_argument('--csv-file', required=True, help='Path to iCite CSV file (from fetch_icite_sample.py)')

    args = parser.parse_args()

    if not os.path.exists(args.csv_file):
        print(f"Error: CSV file '{args.csv_file}' not found")
        sys.exit(1)

    print(f"Processing CSV file: {args.csv_file}")
    citations = process_citation_csv(args.csv_file)
    print(f"Extracted {len(citations)} citation records")

    print("\nSample data (first 5 entries):")
    for c in citations[:5]:
        print(f"  PMID {c['pmid']}: {c['citation_count']} citations, RCR {c['relative_citation_ratio']:.2f}")

    print("\nCreating BigQuery table...")
    create_bigquery_table(args.project_id, args.dataset_id, args.table_id)

    print("Loading data into BigQuery...")
    load_data_to_bigquery(args.project_id, args.dataset_id, args.table_id, citations)

    print("\nDone! Citation data has been loaded into BigQuery.")


if __name__ == "__main__":
    main()
