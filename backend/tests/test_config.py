import os
import unittest
from unittest.mock import patch

from capricorn_runtime.config import (database_id, project_id, positive_int,
                                     table_id, article_count, output_token_limit)


class ConfigTests(unittest.TestCase):
    def test_project_and_database_must_be_explicit(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                project_id()
            with self.assertRaises(ValueError):
                database_id()
        with patch.dict(os.environ, {'PROJECT_ID': 'synthetic-project',
                                    'DATABASE_ID': 'capricorn-dev'}, clear=True):
            self.assertEqual(project_id(), 'synthetic-project')
            self.assertEqual(database_id(), 'capricorn-dev')

    def test_identifier_cannot_include_sql(self):
        self.assertEqual(table_id('synthetic-project.model.textembed'),
                         'synthetic-project.model.textembed')
        with self.assertRaises(ValueError):
            table_id('synthetic-project.model.textembed`; DROP TABLE anything; --')

    def test_development_article_limit_is_enforced_on_server(self):
        with patch.dict(os.environ, {'MAX_ARTICLES': '1'}, clear=True):
            self.assertEqual(article_count(1), 1)
            for value in [0, -1, 2, True, '1', None, 1.5]:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    article_count(value)

    def test_invalid_positive_integer_setting_fails_closed(self):
        for value in ['0', '-1', 'x']:
            with patch.dict(os.environ, {'TEST_LIMIT': value}):
                with self.assertRaises(ValueError):
                    positive_int('TEST_LIMIT', 5)

    def test_global_output_cap_never_increases_a_small_operation_limit(self):
        with patch.dict(os.environ, {'GEMINI_MAX_OUTPUT_TOKENS': '8192'}):
            self.assertEqual(output_token_limit(1024), 1024)
            self.assertEqual(output_token_limit(65535), 8192)
