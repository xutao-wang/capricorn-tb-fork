"""Keep generated findings within the validator's configured search budget."""
import inspect
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from flask import Flask, make_response, request
import test_backend_integration as integration
from test_backend_integration import BACKEND, load_source


class EventGenerationContractTests(unittest.TestCase):
    setUp = integration.BackendIntegrationTests.setUp

    def invoke(self, module, output):
        specialty = json.loads((BACKEND / 'specialties/tuberculosis.json').read_text())
        module.client.models.generate_content.return_value = SimpleNamespace(text=output)
        with patch.object(module, 'get_specialty', return_value=specialty):
            with Flask('bounded-events').test_request_context('/', method='POST', json={
                'text': 'Synthetic reviewed cavitation with laboratory-confirmed rifampicin resistance.',
                'specialtyId': 'tuberculosis',
            }):
                return make_response(inspect.unwrap(module.extract_events)(request))

    def test_model_schema_matches_configured_event_limit(self):
        for limit in [10, 3]:
            with self.subTest(limit=limit), patch.dict(os.environ, {'MAX_EVENTS': str(limit)}):
                module = load_source('pubmed-search-tester-extract-events')
                response = self.invoke(module, '["Reviewed cavitation", "Rifampicin resistance (rpoB S531L)"]')
                self.assertEqual(response.status_code, 200)
                config = module.client.models.generate_content.call_args.kwargs['config']
                self.assertEqual(config.response_mime_type, 'application/json')
                schema = config.response_schema
                self.assertEqual(schema.type.value, 'ARRAY')
                self.assertEqual(schema.max_items, limit)
                self.assertEqual(schema.items.type.value, 'STRING')
                prompt = module.client.models.generate_content.call_args.kwargs['contents'][0].parts[0].text
                self.assertIn(f'at most {limit}', prompt)
                self.assertIn('Do not invent', prompt)
                self.assertIn('JSON array', prompt)

    def test_schema_does_not_bypass_semantic_validation(self):
        for output in ['[]', '["No actionable events identified"]', json.dumps([f'synthetic finding {i}' for i in range(11)])]:
            with self.subTest(output=output):
                module = load_source('pubmed-search-tester-extract-events')
                self.assertEqual(self.invoke(module, output).status_code, 422)


if __name__ == '__main__':
    unittest.main()
