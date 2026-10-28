"""Explicit deployment configuration; never fall back to another project."""
import os
import re


def project_id():
    value = (os.environ.get('PROJECT_ID') or os.environ.get('GENAI_PROJECT_ID')
             or os.environ.get('GOOGLE_CLOUD_PROJECT'))
    if not value or not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', value):
        raise ValueError('Configure a valid PROJECT_ID')
    return value


def database_id():
    value = os.environ.get('DATABASE_ID')
    if not value or not re.fullmatch(r'\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9]', value):
        raise ValueError('Configure DATABASE_ID explicitly')
    return value


def model_name(default):
    return os.environ.get('GEMINI_MODEL') or default


def positive_int(name, default):
    value = int(os.environ.get(name, str(default)))
    if value < 1:
        raise ValueError(f'{name} must be positive')
    return value


def output_token_limit(default):
    return min(default, positive_int('GEMINI_MAX_OUTPUT_TOKENS', default))


def article_count(value):
    if type(value) is not int or not 1 <= value <= positive_int('MAX_ARTICLES', 1):
        raise ValueError('Article count exceeds the configured development limit')
    return value


def table_id(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+', value):
        raise ValueError('Invalid BigQuery table or model identifier')
    return value


def corpus_table():
    return table_id(os.environ.get(
        'PUBMED_TABLE', 'bigquery-public-data.pmc_open_access_commercial.articles'))


def query_config(parameters=()):
    from google.cloud import bigquery
    return bigquery.QueryJobConfig(
        query_parameters=list(parameters),
        maximum_bytes_billed=positive_int('BQ_MAX_BYTES_BILLED', 150_000_000_000),
    )
