import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[2]/'backend/specialties/seed_firestore.py'

def load_seed():
    spec=importlib.util.spec_from_file_location('tb_seed_selection', MODULE)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class SeedSelectionTests(unittest.TestCase):
    def test_only_requested_tuberculosis_document_is_created(self):
        module=load_seed()
        with patch.object(sys,'argv',['seed_firestore.py','--project-id','synthetic-project','--database-id','capricorn-dev','--specialty-id','tuberculosis']), patch.object(module.firestore,'Client') as factory:
            module.main()
            client=factory.return_value
            client.collection.return_value.document.assert_called_once_with('tuberculosis')
            document=client.collection.return_value.document.return_value
            document.create.assert_called_once()
            self.assertEqual(document.create.call_args.args[0]['id'],'tuberculosis')
            document.set.assert_not_called()

    def test_unknown_selection_fails_before_cloud_client(self):
        module=load_seed()
        with patch.object(sys,'argv',['seed_firestore.py','--project-id','synthetic-project','--database-id','capricorn-dev','--specialty-id','unavailable']), patch.object(module.firestore,'Client') as factory:
            with self.assertRaises(SystemExit):
                module.main()
            factory.assert_not_called()

if __name__=='__main__': unittest.main()
