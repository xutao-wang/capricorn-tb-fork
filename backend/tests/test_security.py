"""Synthetic request-boundary tests; Firebase verification is the SDK boundary."""
import os
import unittest
from unittest.mock import patch

from flask import Flask, g

from capricorn_runtime.security import protected_http


class RequestBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'PROJECT_ID': 'synthetic-project',
            'ALLOWED_ORIGINS': 'https://synthetic.example',
            'ALLOWED_EMAILS': 'owner@example.org',
            'MAX_REQUEST_BYTES': '1024',
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.calls = 0
        app = Flask(__name__)

        @app.route('/', methods=['POST', 'OPTIONS', 'GET'])
        @protected_http
        def handler(_request):
            self.calls += 1
            return {'uid': g.user_id}, 200, {'Access-Control-Allow-Origin': '*'}

        self.client = app.test_client()
        self.verifier = patch('capricorn_runtime.security.verify_token')
        self.verify = self.verifier.start()
        self.addCleanup(self.verifier.stop)
        self.verify.return_value = {
            'uid': 'synthetic-uid', 'email': 'owner@example.org',
            'email_verified': True,
            'firebase': {'sign_in_provider': 'google.com'},
        }
        self.headers = {
            'Origin': 'https://synthetic.example',
            'Authorization': 'Bearer synthetic-token',
        }

    def post(self, payload=None, headers=None):
        return self.client.post('/', json=payload if payload is not None else {},
                                headers=self.headers if headers is None else headers)

    def test_missing_token_cannot_call_handler(self):
        response = self.post(headers={'Origin': 'https://synthetic.example'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, 0)
        self.verify.assert_not_called()

    def test_invalid_token_does_not_expose_verification_error(self):
        self.verify.side_effect = ValueError('secret-bearing SDK exception')
        response = self.post()
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('secret-bearing', response.get_data(as_text=True))
        self.assertEqual(self.calls, 0)

    def test_anonymous_unverified_and_unlisted_identities_are_rejected(self):
        for change in [
            {'firebase': {'sign_in_provider': 'anonymous'}},
            {'email_verified': False}, {'email': 'stranger@example.org'},
            {'uid': ''},
        ]:
            with self.subTest(change=change):
                claims = dict(self.verify.return_value)
                claims.update(change)
                self.verify.return_value = claims
                self.assertEqual(self.post().status_code, 403)
                self.assertEqual(self.calls, 0)
                self.verify.return_value = {
                    'uid': 'synthetic-uid', 'email': 'owner@example.org',
                    'email_verified': True,
                    'firebase': {'sign_in_provider': 'google.com'},
                }

    def test_cross_user_chat_request_is_rejected(self):
        self.assertEqual(self.post({'userId': 'another-user'}).status_code, 403)
        self.assertEqual(self.calls, 0)

    def test_valid_caller_reaches_handler_and_wildcard_cors_is_replaced(self):
        response = self.post({'userId': 'synthetic-uid'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['uid'], 'synthetic-uid')
        self.assertEqual(response.headers['Access-Control-Allow-Origin'],
                         'https://synthetic.example')
        self.assertIn('Origin', response.headers['Vary'])

    def test_disallowed_origin_is_rejected_before_verification(self):
        headers = dict(self.headers, Origin='https://attacker.example')
        self.assertEqual(self.post(headers=headers).status_code, 403)
        self.verify.assert_not_called()

    def test_preflight_allows_only_configured_post_headers(self):
        response = self.client.options('/', headers={
            'Origin': 'https://synthetic.example',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        })
        self.assertEqual(response.status_code, 204)
        self.assertIn('Authorization', response.headers['Access-Control-Allow-Headers'])
        self.verify.assert_not_called()
        self.assertEqual(self.calls, 0)

    def test_missing_allowlist_fails_closed(self):
        del os.environ['ALLOWED_EMAILS']
        self.assertEqual(self.post().status_code, 503)
        self.verify.assert_not_called()

    def test_non_object_json_and_oversized_body_are_rejected(self):
        self.assertEqual(self.post(['synthetic']).status_code, 400)
        self.assertEqual(self.post({'text': 'x' * 2048}).status_code, 413)
        self.assertEqual(self.calls, 0)

    def test_wrong_method_is_rejected(self):
        self.assertEqual(self.client.get('/', headers=self.headers).status_code, 405)
        self.verify.assert_not_called()

    def test_invalid_specialty_path_and_text_types_are_rejected(self):
        for payload in [{'specialtyId': 'other/doc'}, {'text': ['not', 'text']},
                        {'message': 'x' * 50001}]:
            with self.subTest(payload_keys=list(payload)):
                with patch.dict(os.environ, {'MAX_REQUEST_BYTES': '100000'}):
                    self.assertEqual(self.post(payload).status_code, 400)
                self.assertEqual(self.calls, 0)


    def test_configured_limit_cannot_expand_final_article_payload(self):
        with patch.dict(os.environ, {'MAX_ARTICLES':'2'}):
            self.assertEqual(self.post({'analyzed_articles':[{},{}]}).status_code,400)
        self.assertEqual(self.calls,0)

if __name__ == '__main__':
    unittest.main()
