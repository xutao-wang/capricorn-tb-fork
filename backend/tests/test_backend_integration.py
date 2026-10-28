"""Exercise actual entry points with cloud SDKs replaced at their boundary."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
import builtins
import io
from types import SimpleNamespace
from contextlib import redirect_stdout
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from flask import Flask
from google.api_core.exceptions import AlreadyExists

BACKEND = Path(__file__).resolve().parents[1]
FUNCTIONS = {
    'capricorn-chat': 'chat',
    'capricorn-redact-sensitive-info': 'redact_sensitive_info',
    'capricorn-process-lab': 'process_lab',
    'capricorn-retrieve-full-articles': 'retrieve_full_articles',
    'capricorn-final-analysis': 'final_analysis',
    'capricorn-feedback': 'send_feedback_email',
    'pubmed-search-tester-extract-disease': 'extract_disease',
    'pubmed-search-tester-extract-events': 'extract_events',
    'capricorn-detect-specialty': 'detect_specialty',
}


def load_source(folder, filename='main.py'):
    name = 'test_source_' + folder.replace('-', '_') + '_' + filename.replace('.', '_')
    spec = importlib.util.spec_from_file_location(name, BACKEND / folder / filename)
    module = importlib.util.module_from_spec(spec)
    old_path = sys.path[:]
    previous_specialty = sys.modules.pop('specialty', None)
    previous_trials = sys.modules.pop('clinical_trials', None)
    try:
        sys.path.insert(0, str(BACKEND / folder))
        spec.loader.exec_module(module)
    finally:
        sys.path[:] = old_path
        sys.modules.pop('specialty', None)
        sys.modules.pop('clinical_trials', None)
        if previous_specialty is not None:
            sys.modules['specialty'] = previous_specialty
        if previous_trials is not None:
            sys.modules['clinical_trials'] = previous_trials
    return module


class BackendIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {
            'PROJECT_ID': 'synthetic-project', 'GENAI_PROJECT_ID': 'synthetic-project',
            'BIGQUERY_PROJECT_ID': 'synthetic-project', 'DATABASE_ID': 'capricorn-dev',
            'LOCATION': 'global', 'ALLOWED_EMAILS': 'owner@example.org',
            'ALLOWED_ORIGINS': 'https://synthetic.example', 'MAX_ARTICLES': '1',
        }, clear=True))
        self.bq_factory = self.stack.enter_context(patch('google.cloud.bigquery.Client'))
        self.firestore_factory = self.stack.enter_context(patch('google.cloud.firestore.Client'))
        self.stack.enter_context(patch('google.genai.Client'))
        self.stack.enter_context(patch('google.cloud.dlp_v2.DlpServiceClient'))

    def test_every_actual_function_rejects_missing_token(self):
        for folder, entry_point in FUNCTIONS.items():
            with self.subTest(function=folder):
                module = load_source(folder)
                app = Flask(folder)
                with app.test_request_context('/', method='POST', json={},
                                             headers={'Origin': 'https://synthetic.example'}):
                    from flask import make_response, request
                    response = make_response(getattr(module, entry_point)(request))
                    self.assertEqual(response.status_code, 401)

    def test_retrieval_import_performs_no_billable_queries(self):
        load_source('capricorn-retrieve-full-articles')
        self.bq_factory.return_value.query.assert_not_called()

    def test_query_text_is_bound_as_a_parameter(self):
        module = load_source('capricorn-retrieve-full-articles')
        payload = 'synthetic """; SELECT secret; --'
        query = module.create_bq_query(payload, num_articles=1, disease='synthetic disease')
        self.assertNotIn(payload, query)
        self.assertIn('@query_text', query)
        self.assertIn('LIMIT 1', query)

    def test_final_article_ids_are_bound_and_query_has_a_byte_budget(self):
        module = load_source('capricorn-final-analysis')
        self.bq_factory.return_value.query.return_value.result.return_value = []
        module.get_full_articles([{'pmcid': 'PMC123'}])
        call = self.bq_factory.return_value.query.call_args
        self.assertIn('UNNEST(@pmcids)', call.args[0])
        self.assertNotIn("'PMC123'", call.args[0])
        config = call.kwargs['job_config']
        self.assertGreater(config.maximum_bytes_billed, 0)
        self.assertEqual(config.query_parameters[0].values, ['PMC123'])

    def test_loaders_never_delete_or_overwrite_existing_rows(self):
        folder = 'capricorn-retrieve-full-articles'
        for filename in ['load_journal_data_to_bq.py', 'load_citation_data_to_bq.py']:
            with self.subTest(loader=filename):
                client = MagicMock()
                self.bq_factory.return_value = client
                module = load_source(folder, filename)
                module.create_bigquery_table('synthetic-project', 'test_data', 'test_table')
                client.delete_table.assert_not_called()
                module.load_data_to_bigquery('synthetic-project', 'test_data', 'test_table', [])
                config = client.load_table_from_json.call_args.kwargs['job_config']
                self.assertEqual(config.write_disposition, 'WRITE_EMPTY')

    def test_specialty_seed_preserves_existing_documents(self):
        module = load_source('specialties', 'seed_firestore.py')
        document = self.firestore_factory.return_value.collection.return_value.document.return_value
        document.create.side_effect = AlreadyExists('synthetic document exists')
        with patch.object(sys, 'argv', ['seed_firestore.py', '--project-id', 'synthetic-project',
                                       '--database-id', 'capricorn-dev']):
            module.main()
        self.assertEqual(document.create.call_count, 7)
        document.set.assert_not_called()

    def test_redaction_returns_type_names_without_echoing_input_or_patching_print(self):
        module = load_source('capricorn-redact-sensitive-info')
        module.dlp_client.inspect_content.return_value = SimpleNamespace(result=SimpleNamespace(
            findings=[SimpleNamespace(info_type=SimpleNamespace(name='EMAIL_ADDRESS'),
                                      quote='synthetic@example.org')]))
        module.dlp_client.deidentify_content.return_value = SimpleNamespace(
            item=SimpleNamespace(value='Contact [REDACTED]'))
        claims = {'uid': 'synthetic-uid', 'email': 'owner@example.org',
                  'email_verified': True, 'firebase': {'sign_in_provider': 'google.com'}}
        app = Flask('redaction-safety-test')
        original_print = builtins.print
        captured = io.StringIO()
        with app.test_request_context('/', method='POST',
                                     json={'text': 'Contact synthetic@example.org'},
                                     headers={'Authorization': 'Bearer synthetic-token'}), \
             patch('capricorn_runtime.security.verify_token', return_value=claims), \
             redirect_stdout(captured):
            from flask import request
            response = module.redact_sensitive_info(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['identifiedInfoTypes'], ['EMAIL_ADDRESS'])
        self.assertNotIn('synthetic@example.org', response.get_data(as_text=True))
        self.assertNotIn('synthetic@example.org', captured.getvalue())
        self.assertIs(builtins.print, original_print)

    def test_feedback_is_disabled_before_attempting_to_send(self):
        module = load_source('capricorn-feedback')
        claims = {'uid': 'synthetic-uid', 'email': 'owner@example.org',
                  'email_verified': True, 'firebase': {'sign_in_provider': 'google.com'}}
        app = Flask('feedback-disabled-test')
        with app.test_request_context('/', method='POST', json={'feedback': 'Synthetic test'},
                                     headers={'Authorization': 'Bearer synthetic-token'}), \
             patch('capricorn_runtime.security.verify_token', return_value=claims), \
             patch.object(module, 'SendGridAPIClient') as sender:
            from flask import request
            response = module.send_feedback_email(request)
        self.assertEqual(response.status_code, 503)
        sender.assert_not_called()

    def test_invalid_article_limit_rejects_before_firestore_or_queries(self):
        module = load_source('capricorn-retrieve-full-articles')
        claims = {'uid': 'synthetic-uid', 'email': 'owner@example.org',
                  'email_verified': True, 'firebase': {'sign_in_provider': 'google.com'}}
        app = Flask('retrieval-input-test')
        with app.test_request_context('/', method='POST',
                                     json={'events_text': 'synthetic event', 'num_articles': 2},
                                     headers={'Authorization': 'Bearer synthetic-token'}), \
             patch('capricorn_runtime.security.verify_token', return_value=claims), \
             patch.object(module, 'get_specialty') as specialty:
            from flask import request
            response = module.retrieve_full_articles(request)
        self.assertEqual(response.status_code, 400)
        specialty.assert_not_called()
        self.bq_factory.return_value.query.assert_not_called()

    def test_repeated_quota_errors_have_a_finite_retry_limit(self):
        module = load_source('capricorn-retrieve-full-articles')
        from pathlib import Path
        import json
        specialty = json.loads((BACKEND / 'specialties/general_medicine.json').read_text())
        module.client.models.generate_content.side_effect = RuntimeError('429 RESOURCE_EXHAUSTED')
        with patch.dict(os.environ, {'GEMINI_MAX_ATTEMPTS': '2'}), \
             patch.object(module.time, 'sleep') as sleep:
            self.assertIsNone(module.analyze_with_gemini('Synthetic article', 'PMC123', specialty))
        self.assertEqual(module.client.models.generate_content.call_count, 2)
        self.assertEqual(sleep.call_count, 1)


if __name__ == '__main__':
    unittest.main()
