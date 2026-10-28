"""Actual entry point; mock only Firebase verification and the model SDK."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

from flask import Flask
from test_image_findings import valid_findings
from test_image_processing import raster_bytes

IMAGE_DIR = Path(__file__).resolve().parents[1] / 'capricorn-analyze-image'
sys.path.insert(0, str(IMAGE_DIR))
spec = importlib.util.spec_from_file_location('image_endpoint_under_test', IMAGE_DIR / 'main.py')
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


class ImageEndpointTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {
            'PROJECT_ID': 'synthetic-project',
            'ALLOWED_ORIGINS': 'https://synthetic.example',
            'ALLOWED_EMAILS': 'owner@example.org',
        }, clear=True)
        env.start()
        self.addCleanup(env.stop)
        app = Flask(__name__)
        app.add_url_rule('/', view_func=endpoint.analyze_image, methods=['POST', 'GET', 'OPTIONS'])
        self.client = app.test_client()
        verifier = patch('capricorn_runtime.security.verify_token', return_value={
            'uid': 'synthetic-uid', 'email': 'owner@example.org', 'email_verified': True,
            'firebase': {'sign_in_provider': 'google.com'},
        })
        self.verify = verifier.start()
        self.addCleanup(verifier.stop)
        sdk = patch.object(endpoint.genai, 'Client')
        self.sdk = sdk.start()
        self.addCleanup(sdk.stop)
        self.generate = self.sdk.return_value.models.generate_content
        self.generate.return_value = types.SimpleNamespace(text=json.dumps(valid_findings()))
        logger = patch.object(endpoint, 'logger')
        logger.start()
        self.addCleanup(logger.stop)
        self.headers = {'Authorization': 'Bearer synthetic-token', 'Origin': 'https://synthetic.example'}
        self.payload = {'image_data': base64.b64encode(raster_bytes()).decode(),
                        'file_name': 'private-synthetic-name.png'}

    def post(self, payload=None, headers=None):
        return self.client.post('/', json=self.payload if payload is None else payload,
                                headers=self.headers if headers is None else headers)

    def test_missing_invalid_revoked_and_unlisted_auth_precede_image_and_client(self):
        # Invalid image data proves decoding has not been attempted on auth failures.
        with patch.object(endpoint, 'base64') as decoder:
            self.assertEqual(self.post({'image_data': '$'}, headers={'Origin': self.headers['Origin']}).status_code, 401)
            self.verify.side_effect = ValueError('untrusted verification error')
            self.assertEqual(self.post({'image_data': '$'}).status_code, 401)
            from firebase_admin import auth
            self.verify.side_effect = auth.RevokedIdTokenError('synthetic revocation')
            self.assertEqual(self.post({'image_data': '$'}).status_code, 401)
            self.verify.side_effect = None
            self.verify.return_value['email'] = 'unlisted@example.org'
            self.assertEqual(self.post({'image_data': '$'}).status_code, 403)
            decoder.b64decode.assert_not_called()
            self.sdk.assert_not_called()

    def test_malformed_base64_and_type_rejected_before_model(self):
        for value in ('!!!!', 'YQ', 'data:image/png;base64,AA==', 7, None, ''):
            with self.subTest(value_type=type(value).__name__):
                self.assertEqual(self.post({'image_data': value}).status_code, 400)
                self.sdk.assert_not_called()

    def test_base64_limit_checked_before_decode(self):
        with patch.object(endpoint.base64, 'b64decode') as decoder:
            response = self.post({'image_data': 'A' * (4 * ((5 * 1024 * 1024 + 2) // 3) + 4)})
            self.assertEqual(response.status_code, 413)
            decoder.assert_not_called()
        self.sdk.assert_not_called()

    def test_valid_result_uses_strict_draft_envelope_and_bounded_schema_call(self):
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://synthetic.example')
        data = response.json['data']
        self.assertTrue(response.json['success'])
        self.assertTrue(data['reviewRequired'])
        self.assertEqual(data['model'], 'gemini-3.8-flash')
        self.assertEqual(data['parsedFindings'], valid_findings())
        self.assertEqual(data['actionableEvents'], [])
        self.assertTrue(data['previewImage'].startswith('data:image/jpeg;base64,'))
        kwargs = self.generate.call_args.kwargs
        self.assertEqual(kwargs['model'], 'gemini-3.8-flash')
        self.assertIsNotNone(kwargs['config'].response_schema)
        self.assertLessEqual(kwargs['config'].max_output_tokens, 2048)
        self.assertNotIn(self.payload['file_name'], str(kwargs['contents']))
        prompt = kwargs['contents'][0].parts[1].text
        self.assertIn('"PreviewDimensions": "8x8"', prompt)
        self.assertEqual(self.sdk.call_args.kwargs['location'], 'global')

    def test_invalid_missing_and_no_model_output_are_errors_without_fallback(self):
        values = ['{', None, '', json.dumps({}), json.dumps(dict(valid_findings(), modality='invalid'))]
        for value in values:
            self.generate.return_value = types.SimpleNamespace(text=value)
            response = self.post()
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('data', response.json)
            self.assertNotIn('actionableEvents', response.json)

    def test_uninterpretable_valid_draft_has_no_events(self):
        value = valid_findings()
        value['technicalQuality'] = 'uninterpretable'
        for row in value['findings']:
            row['status'] = 'not_assessable'
        self.generate.return_value = types.SimpleNamespace(text=json.dumps(value))
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data']['actionableEvents'], [])
        self.assertTrue(response.json['data']['reviewRequired'])

    def test_untrusted_exceptions_do_not_leak(self):
        self.generate.side_effect = RuntimeError('sensitive upstream body')
        response = self.post()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('sensitive upstream', response.get_data(as_text=True))

    def test_disallowed_origin_and_method_do_not_construct_client(self):
        self.assertEqual(self.post(headers=dict(self.headers, Origin='https://disallowed.example')).status_code, 403)
        self.assertEqual(self.client.get('/', headers=self.headers).status_code, 405)
        self.sdk.assert_not_called()


if __name__ == '__main__':
    unittest.main()
