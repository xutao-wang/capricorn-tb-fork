import importlib.util
import json
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'prepare.py'

class PreparationTests(unittest.TestCase):
    def module(self):
        self.assertTrue(MODULE.exists(), 'local artifact generator must exist')
        spec = importlib.util.spec_from_file_location('prepare', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def config(self, p):
        return p.read_config(MODULE.parent / 'config.example.toml')

    def test_complete_sources_without_cloud_calls(self):
        p = self.module()
        with tempfile.TemporaryDirectory() as tmp, patch('subprocess.run', side_effect=AssertionError('cloud calls forbidden')):
            out = Path(tmp).resolve() / 'artifacts'
            p.generate(self.config(p), out)
            sources = list((out / 'functions').iterdir())
            self.assertEqual(len(sources), 10)
            for source in sources:
                for name in ['main.py', 'requirements.txt', 'capricorn_runtime/security.py', 'capricorn_runtime/clinical.py']:
                    self.assertTrue((source / name).is_file(), str(source / name))
            for helper in ['imaging.py', 'findings.py']:
                self.assertTrue((out / 'functions/capricorn-analyze-image' / helper).is_file())
            files = [str(x.relative_to(out)) for x in out.rglob('*') if x.is_file()]
            self.assertFalse(any('.env' in x or '__pycache__' in x or 'node_modules' in x or x.endswith(('.jpg', '.dcm')) for x in files))
            env = json.loads((out / 'env/capricorn-analyze-image.yaml').read_text())
            self.assertEqual(env['GEMINI_MODEL'], 'gemini-3.8-flash')
            self.assertEqual(env['DATABASE_ID'], 'capricorn-dev')
            self.assertEqual(env['FEEDBACK_ENABLED'], 'false')
            self.assertEqual(env['MAX_ARTICLES'], '1')
            self.assertEqual(json.loads((out / 'review.json').read_text())['frontend_url_keys'][-1], 'REACT_APP_ANALYZE_IMAGE_URL')

    def test_identity_order_limits_and_existing_resources(self):
        p = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp).resolve() / 'artifacts'
            p.generate(self.config(p), out)
            manifest = json.loads((out / 'review.json').read_text())
            identities = manifest['runtime_identities']
            self.assertEqual(identities['capricorn-chat'].split('@')[0], 'capricorn-dev-fn-01')
            self.assertEqual(identities['capricorn-detect-specialty'].split('@')[0], 'capricorn-dev-fn-09')
            self.assertEqual(identities['capricorn-analyze-image'].split('@')[0], 'capricorn-dev-fn-10')
            plan = (out / 'REVIEW-PLAN.md').read_text()
            commands = [shlex.split(line) for line in plan.splitlines() if line.startswith('gcloud functions deploy ')]
            self.assertEqual(len(commands), 10)
            for args in commands:
                for flag in ['--min-instances=0', '--max-instances=1', '--concurrency=1', '--timeout=540s', '--no-allow-unauthenticated', '--stage-bucket=capricorn-src-njms-tb-image-study']:
                    self.assertIn(flag, args)
                self.assertIn('--memory=1Gi' if args[3]=='capricorn-analyze-image' else '--memory=512Mi', args)
            creates = [line for line in plan.splitlines() if line.startswith('gcloud iam service-accounts create ')]
            self.assertEqual(len(creates), 1)
            self.assertIn('capricorn-dev-fn-10', creates[0])
            self.assertNotIn('gcloud firestore databases create', plan)
            self.assertNotIn('CREATE MODEL', plan)
            self.assertNotIn('bq mk', plan)
            self.assertIn('create-only', plan)
            self.assertIn('rollback', plan.lower())
            self.assertIn('roles/aiplatform.user', plan)
            self.assertIn('roles/capricornTokenVerifier', plan)
            self.assertFalse((out / 'remote-model-review.sql').exists())

    def test_rules_and_hosting_match_target(self):
        p = self.module()
        config = dict(self.config(p), allowed_emails=['tester@example.org'])
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp).resolve() / 'artifacts'
            p.generate(config, out)
            policy = (out / 'firebase/firestore.rules').read_text()
            self.assertIn('google.com', policy)
            self.assertIn('tester@example.org', policy)
            self.assertIn('request.auth.uid == userId', policy)
            self.assertNotIn('allow delete', policy)
            firebase = json.loads((out / 'firebase/firebase.json').read_text())
            self.assertEqual(firebase['firestore']['database'], 'capricorn-dev')
            self.assertEqual(firebase['hosting']['site'], 'capricorn-njms-tb-image-study')
            self.assertEqual((out / 'firebase' / firebase['hosting']['public']).resolve(), (p.ROOT / 'frontend/build').resolve())

    def test_replace_requires_unchanged_generated_tree(self):
        p = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp).resolve() / 'artifacts'
            p.generate(self.config(p), out)
            with self.assertRaises(ValueError):
                p.generate(self.config(p), out)
            p.generate(self.config(p), out, replace=True)
            for extra in ['cloud-state.json', 'config.local.toml', 'functions/capricorn-chat/important.txt']:
                marker = out / extra
                marker.write_text('retain')
                with self.subTest(extra=extra), self.assertRaises(ValueError):
                    p.generate(self.config(p), out, replace=True)
                self.assertEqual(marker.read_text(), 'retain')
                marker.unlink()
            env = out / 'env/capricorn-chat.yaml'
            env.write_text('hand-edited: preserve')
            with self.assertRaises(ValueError):
                p.generate(self.config(p), out, replace=True)
            self.assertEqual(env.read_text(), 'hand-edited: preserve')

    def test_refuses_symlinks_and_unrelated_outputs(self):
        p = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp).resolve() / 'unrelated'
            out.mkdir()
            marker = out / 'important.txt'
            marker.write_text('retain')
            with self.assertRaises(ValueError):
                p.generate(self.config(p), out, replace=True)
            target = Path(tmp).resolve() / 'target'
            target.mkdir()
            link = Path(tmp).resolve() / 'linked'
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError):
                p.generate(self.config(p), link / 'artifacts')
            self.assertEqual(marker.read_text(), 'retain')

    def test_rejects_missing_and_injected_config(self):
        p = self.module()
        config = self.config(p)
        for field, value in [('project_id','x; touch /tmp/bad'), ('allowed_emails',[]), ('allowed_origins',[]), ('models',{}), ('database_id','a'), ('deployer_account','bad account'), ('hosting_site','../wrong'), ('clinical_trials_model','unsafe/model')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                p.validate(dict(config, **{field:value}))
        for origin in ['https://example.com/$(touch bad)', 'https://example.com/path', '*']:
            with self.assertRaises(ValueError):
                p.validate(dict(config, allowed_origins=[origin]))

if __name__ == '__main__':
    unittest.main()
