import inspect
import json
import os
import unittest
from unittest.mock import MagicMock, patch
from flask import Flask, request
from google.api_core.exceptions import AlreadyExists
import test_backend_integration as integration
from test_backend_integration import load_source, BACKEND


class ReviewFixTests(unittest.TestCase):
    setUp = integration.BackendIntegrationTests.setUp
    # Reuse only the SDK-isolating fixture, not inherited tests.
    def test_sentinel_logs(self):
        sentinel = 'SYNTHETIC_PRIVATE_SENTINEL'
        trials = load_source('capricorn-final-analysis', 'clinical_trials.py')
        with patch.object(trials.urllib.request, 'urlopen', side_effect=RuntimeError(sentinel)), self.assertLogs(trials.logger) as logs:
            trials._ctgov_request({'query.term': sentinel})
        self.assertNotIn(sentinel, '\n'.join(logs.output))
        client = MagicMock()
        client.models.generate_content.side_effect = RuntimeError(sentinel)
        trial = dict(nctId='NCT1', briefTitle='test', overallStatus='test', phase='test', briefSummary='', eligibilityCriteria='')
        with self.assertLogs(trials.logger) as logs:
            trials.screen_trials_for_event(sentinel, sentinel, sentinel, [trial], client)
        self.assertNotIn(sentinel, '\n'.join(logs.output))
        detector = load_source('capricorn-detect-specialty')
        with patch.object(detector, '_call_gemini', side_effect=RuntimeError(sentinel)), self.assertLogs(detector.logger) as logs:
            detector._classify([], sentinel)
        self.assertNotIn(sentinel, '\n'.join(logs.output))
        with patch.object(detector, '_call_gemini', return_value=json.dumps({'specialtyId': sentinel})), self.assertLogs(detector.logger) as logs:
            detector._classify([], sentinel)
        self.assertNotIn(sentinel, '\n'.join(logs.output))
        specialty = load_source('capricorn-detect-specialty', 'specialty.py')
        config = json.loads((BACKEND / 'specialties/general_medicine.json').read_text())
        config['articleScoring']['fields'] = [{'key': sentinel}]
        self.assertNotIn(sentinel, specialty.validate_specialty_config(config)[1])

    def test_lab_traceback_does_not_log_exception_body(self):
        module = load_source('capricorn-process-lab')
        self.stack.enter_context(patch.object(module.genai, 'Client', side_effect=RuntimeError('SYNTHETIC_PRIVATE_SENTINEL')))
        with Flask('lab').test_request_context('/', method='POST', json={'pdf_data':'YQ=='}), self.assertLogs(module.logger) as logs:
            inspect.unwrap(module.process_lab)(request)
        self.assertNotIn('SYNTHETIC_PRIVATE_SENTINEL', '\n'.join(logs.output))

    def test_atomic_specialty_collision_preserves_document(self):
        module = load_source('capricorn-detect-specialty', 'specialty.py')
        document = self.firestore_factory.return_value.collection.return_value.document.return_value
        document.create.side_effect = AlreadyExists('synthetic collision')
        self.assertIsNone(module.save_generated_specialty({'id':'existing'}, 'synthetic'))
        document.create.assert_called_once()
        document.set.assert_not_called()

    def test_screening_model_and_token_cap(self):
        with patch.dict(os.environ, {'CLINICAL_TRIALS_MODEL':'explicit-screening-proposal', 'GEMINI_MAX_OUTPUT_TOKENS':'123'}):
            module = load_source('capricorn-final-analysis', 'clinical_trials.py')
            client = MagicMock()
            client.models.generate_content.return_value.text = '[]'
            trial = dict(nctId='NCT1', briefTitle='test', overallStatus='test', phase='test', briefSummary='', eligibilityCriteria='')
            module.screen_trials_for_event('synthetic', 'synthetic', 'synthetic', [trial], client)
            self.assertEqual(client.models.generate_content.call_args.kwargs['model'], 'explicit-screening-proposal')
            self.assertEqual(client.models.generate_content.call_args.kwargs['config'].max_output_tokens, 123)

    def test_reference_cache_retries_journal_failure_without_scoring(self):
        module = load_source('capricorn-retrieve-full-articles')
        client = self.bq_factory.return_value
        journal = MagicMock()
        journal.result.return_value = [{'title': 'Synthetic Journal', 'sjr': 2.5}]
        client.query.side_effect = [RuntimeError('transient'), journal, MagicMock()]
        with self.assertRaises(RuntimeError):
            module.load_reference_data()
        module.load_reference_data()
        self.assertEqual(module.journal_impact_data, {'Synthetic Journal': 2.5})
        self.assertEqual(client.query.call_count, 3)
        module.load_reference_data()
        self.assertEqual(client.query.call_count, 3)

    def test_reference_cache_retries_only_failed_citations(self):
        module = load_source('capricorn-retrieve-full-articles')
        client = self.bq_factory.return_value
        journal = MagicMock()
        journal.result.return_value = [{'title': 'Synthetic Journal', 'sjr': 2.5}]
        citations = MagicMock()
        citations.result.return_value = [{'pmid':'123', 'citation_count':5, 'relative_citation_ratio':1.5}]
        client.query.side_effect = [journal, RuntimeError('transient'), citations]
        with self.assertLogs(module.logger, level='WARNING') as logs:
            module.load_reference_data()
        self.assertIn('citation scoring degraded', '\n'.join(logs.output))
        module.load_reference_data()
        self.assertEqual(module.journal_impact_data, {'Synthetic Journal': 2.5})
        self.assertEqual(module.citation_data['123']['citation_count'], 5)
        self.assertEqual(client.query.call_count, 3)
        module.load_reference_data()
        self.assertEqual(client.query.call_count, 3)
