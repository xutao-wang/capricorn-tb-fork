#!/usr/bin/env python3
"""
Script to load SCImago Journal Rank data into BigQuery
This script processes the scimagojr CSV file and loads it into BigQuery
"""
import csv
import os
import sys
from google.cloud import bigquery
import argparse

def process_scimagojr_csv(csv_file_path):
    """Process the SCImago CSV file and extract relevant data"""
    journals = []
    
    with open(csv_file_path, 'r', encoding='utf-8') as file:
        # Use semicolon as delimiter
        csv_reader = csv.DictReader(file, delimiter=';')
        
        for row in csv_reader:
            # Extract title and SJR score
            title = row['Title'].strip()
            sjr_str = row['SJR'].strip()
            
            # Convert SJR to float, replacing comma with dot for decimal
            try:
                sjr = float(sjr_str.replace(',', '.'))
            except ValueError:
                print(f"Warning: Could not parse SJR value '{sjr_str}' for journal '{title}'")
                sjr = 0.0
            
            journals.append({
                'title': title,
                'sjr': sjr
            })
    
    return journals

def create_bigquery_table(project_id, dataset_id, table_id):
    """Create BigQuery table with the appropriate schema"""
    client = bigquery.Client(project=project_id)
    
    # Define schema
    schema = [
        bigquery.SchemaField("title", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("sjr", "FLOAT64", mode="REQUIRED"),
    ]
    
    # Create table reference
    table_ref = f"{project_id}.{dataset_id}.{table_id}"
    table = bigquery.Table(table_ref, schema=schema)
    
    table = client.create_table(table, exists_ok=True)
    print(f"Ensured table {table_ref}; existing data is preserved")
    
    return table_ref

def load_data_to_bigquery(project_id, dataset_id, table_id, journals_data):
    """Load journal data into BigQuery"""
    client = bigquery.Client(project=project_id)
    
    # Get table reference
    table_ref = f"{project_id}.{dataset_id}.{table_id}"
    
    # Configure load job
    job_config = bigquery.LoadJobConfig(
        schema=[
            bigquery.SchemaField("title", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("sjr", "FLOAT64", mode="REQUIRED"),
        ],
        write_disposition="WRITE_EMPTY",  # Refuse to overwrite populated tables
    )
    
    # Load data
    job = client.load_table_from_json(journals_data, table_ref, job_config=job_config)
    job.result()  # Wait for job to complete
    
    # Get table info
    table = client.get_table(table_ref)
    print(f"Loaded {table.num_rows} rows into {table_ref}")

def main():
    parser = argparse.ArgumentParser(description='Load SCImago Journal Rank data into BigQuery')
    parser.add_argument('--project-id', required=True, help='GCP Project ID')
    parser.add_argument('--dataset-id', required=True, help='BigQuery Dataset ID (e.g., journal_rank)')
    parser.add_argument('--table-id', default='scimagojr_2024', help='BigQuery Table ID (default: scimagojr_2024)')
    parser.add_argument('--csv-file', default='scimagojr_2024.csv', help='Path to SCImago CSV file')
    
    args = parser.parse_args()
    
    # Check if CSV file exists
    if not os.path.exists(args.csv_file):
        print(f"Error: CSV file '{args.csv_file}' not found")
        sys.exit(1)
    
    print(f"Processing CSV file: {args.csv_file}")
    journals = process_scimagojr_csv(args.csv_file)
    print(f"Extracted {len(journals)} journal entries")
    
    # Show sample data
    print("\nSample data (first 5 entries):")
    for i, journal in enumerate(journals[:5]):
        print(f"  {journal['title']}: {journal['sjr']}")
    
    # Create BigQuery table
    print(f"\nCreating BigQuery table...")
    create_bigquery_table(args.project_id, args.dataset_id, args.table_id)
    
    # Load data
    print(f"Loading data into BigQuery...")
    load_data_to_bigquery(args.project_id, args.dataset_id, args.table_id, journals)
    
    print("\nDone! Journal data has been loaded into BigQuery.")
    print(f"\nTo update your application to use this new table:")
    print(f"1. Update the query in fetch_journal_impact_data() in main.py to use '{args.table_id}' instead of 'scimagojr_2023'")
    print(f"2. Redeploy the Cloud Function")

if __name__ == "__main__":
    main()
