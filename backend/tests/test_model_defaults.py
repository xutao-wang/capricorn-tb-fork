"""Inspect actual endpoint model wiring with SDK clients mocked at the boundary."""
import inspect
import os
import unittest
from unittest.mock import patch

from flask import Flask, make_response, request

import test_backend_integration as integration
from test_backend_integration import load_source


class ModelDefaultsTests(unittest.TestCase):
    setUp = integration.BackendIntegrationTests.setUp

    def exercise_chat(self, model, location):
        with patch('google.genai.Client') as factory:
            module = load_source('capricorn-chat')
            self.assertEqual(factory.call_args.kwargs['location'], location)
            factory.return_value.models.generate_content_stream.return_value = []
            with patch.object(module, 'get_specialty', return_value={'id':'synthetic', 'chatContextLabel':'synthetic case'}), patch.object(module, 'get_chat_history', return_value=[]):
                with Flask('chat-defaults').test_request_context('/', method='POST', json={'message':'Synthetic question', 'userId':'synthetic-uid', 'chatId':'synthetic-chat'}):
                    response = inspect.unwrap(module.chat)(request)
                    response.get_data()
            self.assertEqual(factory.return_value.models.generate_content_stream.call_args.kwargs['model'], model)

    def exercise_lab(self, model, location):
        with patch('google.genai.Client') as factory:
            factory.return_value.models.generate_content.return_value.text = 'Synthetic lab result'
            module = load_source('capricorn-process-lab')
            with Flask('lab-defaults').test_request_context('/', method='POST', json={'pdf_data':'YQ=='}):
                response = make_response(inspect.unwrap(module.process_lab)(request))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(factory.call_args.kwargs['location'], location)
            self.assertEqual(factory.return_value.models.generate_content.call_args.kwargs['model'], model)

    def test_chat_defaults_to_approved_model_and_global_location(self):
        os.environ.pop('LOCATION')
        self.exercise_chat('gemini-3.8-flash', 'global')

    def test_chat_default_model_with_explicit_global_location(self):
        self.exercise_chat('gemini-3.8-flash', 'global')

    def test_lab_defaults_to_approved_model_and_global_location(self):
        os.environ.pop('LOCATION')
        self.exercise_lab('gemini-3.8-flash', 'global')

    def test_detector_defaults_to_global_location(self):
        os.environ.pop('LOCATION')
        with patch('google.genai.Client') as factory:
            load_source('capricorn-detect-specialty')
            self.assertEqual(factory.call_args.kwargs['location'], 'global')

    def test_extractor_locations_default_to_global_and_allow_overrides(self):
        os.environ.pop('LOCATION')
        for folder in ['pubmed-search-tester-extract-disease', 'pubmed-search-tester-extract-events']:
            for overrides, expected in [({}, 'global'), ({'LOCATION':'explicit-location'}, 'explicit-location')]:
                with self.subTest(folder=folder, location=expected), patch.dict(os.environ, overrides), patch('google.genai.Client') as factory:
                    load_source(folder)
                    self.assertEqual(factory.call_args.kwargs['location'], expected)

    def test_explicit_model_and_location_overrides_are_preserved(self):
        with patch.dict(os.environ, {'GEMINI_MODEL':'explicit-model', 'LOCATION':'explicit-location'}):
            self.exercise_chat('explicit-model', 'explicit-location')
            self.exercise_lab('explicit-model', 'explicit-location')
            with patch('google.genai.Client') as factory:
                module = load_source('capricorn-detect-specialty')
                self.assertEqual(module.MODEL, 'explicit-model')
                self.assertEqual(factory.call_args.kwargs['location'], 'explicit-location')
