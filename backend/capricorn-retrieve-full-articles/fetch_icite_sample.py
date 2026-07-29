#!/usr/bin/env python3
"""
Bulk-fetches citation count and Relative Citation Ratio (RCR) from the NIH
iCite API (https://icite.od.nih.gov/) for a list of PMIDs, in batches of
1000 (the API's max per request), and writes the result to a CSV ready for
load_citation_data_to_bq.py.

This is a sampled subset of iCite's full dataset (which covers ~all of
PubMed, tens of millions of records) -- see docs/citation-scoring-plan.md
at the repo root for why a full bulk load wasn't done here, and what a
production rollout would need instead.

Usage: python fetch_icite_sample.py --pmids-file pmids.csv --out citations.csv
"""
import argparse
import csv
import time
import urllib.request
import json


def fetch_batch(pmids):
    pmids_param = ",".join(pmids)
    url = f"https://icite.od.nih.gov/api/pubs?pmids={pmids_param}"
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pmids-file', required=True, help='CSV with a "pmid" column')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    with open(args.pmids_file) as f:
        reader = csv.DictReader(f)
        pmids = [row['pmid'].strip() for row in reader if row['pmid'].strip()]

    print(f"Fetching iCite data for {len(pmids)} PMIDs in batches of 1000...")

    results = []
    batch_size = 150
    for i in range(0, len(pmids), batch_size):
        batch = pmids[i:i + batch_size]
        try:
            data = fetch_batch(batch)
            for rec in data.get('data', []):
                results.append({
                    'pmid': rec.get('pmid'),
                    'citation_count': rec.get('citation_count') or 0,
                    'relative_citation_ratio': rec.get('relative_citation_ratio') or 0.0
                })
            print(f"  Batch {i // batch_size + 1}: fetched {len(data.get('data', []))} records")
        except Exception as e:
            print(f"  Batch {i // batch_size + 1} failed: {e}")
        time.sleep(1)  # be polite to the public API

    with open(args.out, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['pmid', 'citation_count', 'relative_citation_ratio'])
        writer.writeheader()
        writer.writerows(results)

    print(f"Wrote {len(results)} citation records to {args.out}")


if __name__ == '__main__':
    main()
