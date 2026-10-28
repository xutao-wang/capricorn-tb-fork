#!/usr/bin/env python3
"""Create local review artifacts only; no subprocesses, network or cloud changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import tempfile
import tomllib
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = dict(zip([
    'capricorn-chat', 'capricorn-redact-sensitive-info', 'capricorn-process-lab',
    'capricorn-retrieve-full-articles', 'capricorn-final-analysis', 'capricorn-feedback',
    'pubmed-search-tester-extract-disease', 'pubmed-search-tester-extract-events',
    'capricorn-detect-specialty', 'capricorn-analyze-image'], [
    'chat', 'redact_sensitive_info', 'process_lab', 'retrieve_full_articles',
    'final_analysis', 'send_feedback_email', 'extract_disease', 'extract_events', 'detect_specialty', 'analyze_image']))

def read_config(path):
    with open(path, 'rb') as stream:
        config = tomllib.load(stream)
    validate(config)
    return config

def validate(c):
    if not isinstance(c.get('project_id'), str) or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', c['project_id']):
        raise ValueError('project_id must be a valid 6–30 character Google Cloud project ID')
    patterns = {
        'hosting_site': r'[a-z0-9][a-z0-9-]{3,61}[a-z0-9]',
        'region': r'[a-z]+-[a-z]+[0-9]', 'gemini_location': r'[a-z0-9-]+',
        'bigquery_location': r'[A-Za-z0-9-]+', 'database_id': r'\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9]',
        'model_dataset': r'[A-Za-z_][A-Za-z0-9_]*', 'journal_dataset': r'[A-Za-z_][A-Za-z0-9_]*',
        'citation_dataset': r'[A-Za-z_][A-Za-z0-9_]*', 'connection_id': r'[A-Za-z_][A-Za-z0-9_]*',
        'pubmed_table': r'[a-z0-9-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+'}
    for key, pattern in patterns.items():
        if not isinstance(c.get(key), str) or not re.fullmatch(pattern, c[key]):
            raise ValueError(f'{key}: missing or unsafe identifier')
    if not isinstance(c.get('clinical_trials_model'), str) or not re.fullmatch(r'[a-zA-Z0-9._-]+', c['clinical_trials_model']):
        raise ValueError('clinical_trials_model requires an explicit safe model proposal')
    if not isinstance(c.get('deployer_account'), str) or not re.fullmatch(r'[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]+', c['deployer_account']):
        raise ValueError('deployer_account requires an explicit lowercase email')
    emails = c.get('allowed_emails')
    if not isinstance(emails, list) or not emails or any(not isinstance(e, str) or not re.fullmatch(r'[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]+', e) for e in emails):
        raise ValueError('allowed_emails requires explicit lowercase email addresses')
    origins = c.get('allowed_origins')
    if not isinstance(origins, list) or not origins:
        raise ValueError('allowed_origins requires explicit browser origins')
    for origin in origins:
        if not isinstance(origin, str) or not re.fullmatch(r'https?://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?', origin):
            raise ValueError('allowed_origins must be exact http(s) origins without paths')
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' and parsed.hostname not in ('localhost', '127.0.0.1'):
            raise ValueError('HTTP origins are allowed only for localhost')
    if set(c.get('models', {})) != set(FUNCTIONS):
        raise ValueError('models requires an explicit proposed selection for every function')
    if any(not isinstance(v, str) or not re.fullmatch(r'[a-zA-Z0-9._-]+', v) for v in c['models'].values()):
        raise ValueError('unsafe model identifier')

def rules(emails):
    return '''rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function approved() {
      return request.auth != null
        && request.auth.token.firebase.sign_in_provider == 'google.com'
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower() in EMAILS;
    }
    match /chats/{userId}/conversations/{conversationId} {
      allow read, write: if approved() && request.auth.uid == userId;
    }
    match /users/{userId}/weightPresets/{presetId} {
      allow read, write: if approved() && request.auth.uid == userId;
    }
    match /specialties/{id} {
      allow read: if approved();
      allow create, update: if approved();
    }
    match /specialties/{id}/history/{historyId} {
      allow read, create: if approved();
    }
    match /{document=**} { allow read, write: if false; }
  }
}
'''.replace('EMAILS', json.dumps(emails))

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')

def tree_manifest(path):
    entries = {}
    for entry in path.rglob('*'):
        if entry.is_symlink():
            raise ValueError('symlinks are not allowed in generated artifacts')
        relative = str(entry.relative_to(path))
        if relative == 'generated-manifest.json':
            continue
        entries[relative] = (hashlib.sha256(entry.read_bytes()).hexdigest()
                             if entry.is_file() else 'directory')
    return entries


def check_replace(output):
    marker = output / 'generated-manifest.json'
    try:
        manifest = json.loads(marker.read_text())
    except (OSError, ValueError):
        raise ValueError('replacement requires an unchanged generated manifest') from None
    if (not isinstance(manifest, dict) or manifest.get('version') != 1 or not isinstance(manifest.get('entries'), dict)
            or tree_manifest(output) != manifest['entries']):
        raise ValueError('output contains active state, unknown files or local edits; choose a new output directory')


def generate(c, output, replace=False):
    validate(c)
    output = Path(output).absolute()
    if any(path.is_symlink() for path in (output, *output.parents)):
        raise ValueError('symlink output paths are unsafe')
    output = output.resolve()
    if output.exists() and not replace:
        raise ValueError(f'{output} already exists; inspect it or explicitly use --replace')
    if output.is_symlink() or output == ROOT or ROOT.is_relative_to(output) or output in (ROOT / 'backend', ROOT / 'frontend', ROOT / 'deploy'):
        raise ValueError('unsafe output path')
    if output.exists() and replace:
        check_replace(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='capricorn-prepare-', dir=output.parent) as tmp:
        stage = Path(tmp) / 'artifacts'
        stage.mkdir()
        env = {key: c[field] for key, field in {
            'PROJECT_ID':'project_id', 'GENAI_PROJECT_ID':'project_id', 'BIGQUERY_PROJECT_ID':'project_id',
            'DATABASE_ID':'database_id', 'LOCATION':'gemini_location', 'MODEL_DATASET':'model_dataset',
            'JOURNAL_DATASET':'journal_dataset', 'CITATION_DATASET':'citation_dataset',
            'PUBMED_TABLE':'pubmed_table', 'BIGQUERY_LOCATION':'bigquery_location'}.items()}
        env.update(ALLOWED_EMAILS=','.join(c['allowed_emails']), ALLOWED_ORIGINS=','.join(c['allowed_origins']),
                   MAX_ARTICLES='1', MAX_EVENTS='10', MAX_TEXT_CHARACTERS='50000', GEMINI_MAX_ATTEMPTS='3', GEMINI_MAX_OUTPUT_TOKENS='8192',
                   BQ_MAX_BYTES_BILLED='150000000000', FEEDBACK_ENABLED='false')
        build_identity = f'capricorn-dev-build@{c["project_id"]}.iam.gserviceaccount.com'
        source_bucket = f'capricorn-src-{c["project_id"]}'
        repository = f'projects/{c["project_id"]}/locations/{c["region"]}/repositories/capricorn-functions'
        commands = []
        identities = {}
        for index, (name, entry) in enumerate(FUNCTIONS.items(), 1):
            source = stage / 'functions' / name
            source.mkdir(parents=True)
            for filename in ('main.py', 'requirements.txt', 'specialty.py', 'clinical_trials.py', 'imaging.py', 'findings.py'):
                original = ROOT / 'backend' / name / filename
                if original.exists():
                    shutil.copyfile(original, source / filename)
            for required in ('main.py', 'requirements.txt'):
                if not (source / required).exists():
                    raise ValueError(f'missing source: {name}/{required}')
            (source / '.gcloudignore').write_text(
                '.gcloudignore\n__pycache__/\n**/__pycache__/\n*.pyc\n**/*.pyc\n.env*\n**/.env*\n')
            shutil.copytree(ROOT / 'backend/capricorn_runtime', source / 'capricorn_runtime',
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.env*', 'node_modules'))
            write_json(stage / 'env' / (name + '.yaml'), dict(env, GEMINI_MODEL=c['models'][name], CLINICAL_TRIALS_MODEL=c['clinical_trials_model']))
            account = f'capricorn-dev-fn-{index:02d}'
            identity = f'{account}@{c["project_id"]}.iam.gserviceaccount.com'
            identities[name] = identity
            args = ['gcloud', 'functions', 'deploy', name, '--gen2', '--project='+c['project_id'],
                    '--region='+c['region'], '--runtime=python312', '--source=functions/'+name,
                    '--entry-point='+entry, '--trigger-http', '--service-account='+identity,
                    '--build-service-account=projects/'+c['project_id']+'/serviceAccounts/'+build_identity,
                    '--stage-bucket='+source_bucket, '--docker-repository='+repository,
                    '--env-vars-file=env/'+name+'.yaml', '--min-instances=0', '--max-instances=1',
                    '--concurrency=1', '--memory=' + ('1Gi' if name == 'capricorn-analyze-image' else '512Mi'), '--timeout=540s', '--no-allow-unauthenticated']
            commands.append(shlex.join(args))
        firebase = stage / 'firebase'
        firebase.mkdir()
        (firebase / 'firestore.rules').write_text(rules(c['allowed_emails']))
        write_json(firebase / 'firebase.json', {'firestore': {'database':c['database_id'], 'rules':'firestore.rules'},
            'hosting': {'site': c['hosting_site'], 'public':os.path.relpath(ROOT / 'frontend/build', output / 'firebase'),
                'ignore':['firebase.json','**/.*','**/node_modules/**'],
                'rewrites':[{'source':'**','destination':'/index.html'}]}})
        write_json(stage / 'review.json', {'project':c['project_id'], 'runtime_identities':identities,
            'build_identity':build_identity, 'source_bucket':source_bucket, 'artifact_repository':repository,
            'model_status':'Local design approved; cloud apply and additional budget pending',
            'hosting_site':c['hosting_site'], 'deployer_account':c['deployer_account'],
            'models':c['models'], 'clinical_trials_model':c['clinical_trials_model'], 'frontend_blockers':['New image function URL pending deployment', 'Post-deployment image URL configuration and image-enabled release build required'],
            'frontend_url_keys':['REACT_APP_'+key+'_URL' for key in ['CHAT','REDACT','PROCESS_LAB','RETRIEVE_ARTICLES','FINAL_ANALYSIS','FEEDBACK','EXTRACT_DISEASE','EXTRACT_EVENTS','DETECT_SPECIALTY','ANALYZE_IMAGE']],
            'default_articles':1, 'maximum_articles':1})
        (stage / 'REVIEW-PLAN.md').write_text(resource_plan(c, identities, commands))
        write_json(stage / 'generated-manifest.json', {'version':1, 'entries':tree_manifest(stage)})
        if output.exists():
            check_replace(output)
            shutil.rmtree(output)
        shutil.move(str(stage), output)

def resource_plan(c, identities, commands):
    project = c['project_id']
    image_identity = identities['capricorn-analyze-image']
    database_argument = shlex.quote('--database=' + c['database_id'])
    lines = ['# TB imaging upgrade — review only', '',
        'No cloud commands have been run by this generator. Cloud apply and the additional $20 setup/test budget require final approval.',
        f'Use existing project `{project}`, deployer `{c["deployer_account"]}`, region `{c["region"]}`, database `{c["database_id"]}` and Hosting site `{c["hosting_site"]}`.', '',
        '## Existing resources to reuse',
        'Retain the nine deployed functions and their runtime accounts 01–09, Firebase web app/Google provider, Hosting site, named Firestore database and existing specialties/chats. Reuse the dedicated build identity, Artifact Registry repository and private source bucket. No new project, database, bucket, repository, remote embedding model, connection, corpus, journal or citation tables are proposed.',
        'Reuse text-embedding-005 and the verified compatible PubMed corpus. Citation coverage currently contains only three earlier test PMIDs; zero is not proof of no citations. Feedback remains disabled. Do not run initial data loaders.', '',
        '## Read-only readiness checks after approval', '```sh',
        f'gcloud config get-value account',
        f'gcloud projects describe {project}',
        f'gcloud services list --enabled --project={project}',
        f'gcloud firestore databases describe {database_argument} --project={project}',
        f'gcloud functions list --v2 --regions={c["region"]} --project={project}',
        f'gcloud iam service-accounts describe {image_identity} --project={project}',
        f'gcloud iam roles describe capricornTokenVerifier --project={project}', '```',
        'Compare actual resource identities/IAM/env/source before applying. The existing custom role must contain only firebaseauth.users.get. An unexpected collision or permission difference requires review; never replace data to resolve it.', '',
        '## Exact new IAM delta',
        'Create only the missing image runtime account. Its only project grants are Vertex AI access and the existing minimal Firebase token-verification role. No image BQ, Firestore, storage or DLP grant is needed. Preserve existing IAM with etags; do not grant project-wide public invocation.', '```sh',
        f'gcloud iam service-accounts create capricorn-dev-fn-10 --project={project}',
        f'gcloud projects add-iam-policy-binding {project} --member=serviceAccount:{image_identity} --role=roles/aiplatform.user',
        f'gcloud projects add-iam-policy-binding {project} --member=serviceAccount:{image_identity} --role=projects/{project}/roles/capricornTokenVerifier', '```', '',
        '## Create-only TB specialty',
        'Use backend/specialties/seed_firestore.py --project-id ' + project + ' --database-id ' + c['database_id'] + ' --specialty-id tuberculosis for the create-only seed. If the document exists, skip it and report its state. Do not seed or overwrite other specialties. Existing database IAM remains conditioned on resource.name == "projects/' + project + '/databases/' + c['database_id'] + '". Existing roles/datastore.viewer specialty readers and roles/datastore.user classifier writer retain their current scopes.', '',
        '## Function update/addition plan',
        'Update the existing nine functions with staged protected sources and explicit supported model configuration; add capricorn-analyze-image with analyze_image entrypoint and runtime account 10. Staged image source includes imaging.py and findings.py. Run reviewed commands from this generated directory only after approval.',
        'All functions: Python 3.12; min 0/max 1/concurrency 1/540 seconds. Image 1 GiB, others 512 MiB. One displayed/scored article, maximum 150 GB per query; count model inputs and dry-run queries, reserve spend in the new TB ledger before paid tests. Image requests at most 5 MiB encoded-file input and 16 million decoded pixels, single frame/slice only. General vision output requires human review and is not a clinical accuracy validation.', '```sh', *commands, '```',
        'Private deployment is followed by actual-service auth/scaling/source checks. Retain or restore only separately approved per-service roles/run.invoker allUsers transport bindings, with the Firebase Google allowlist/revocation guard verified before exposure. Resolve actual service names; no project-wide binding.', '',
        '## Existing Hosting and rules',
        'Render actual Firebase web configuration and deployed URLs into ignored local frontend env files, including the new image URL after deployment. Build once configured. Publish only the reviewed build and generated owner-scoped Firestore rules using firebase/firebase.json and the explicit project/site. The generic checked-in rules deny all. No unverified bundled CXR/DICOM sample is released.', '',
        '## Rollback and pause',
        'Keep the original checkout and its active .deploy source/config/cloud-state/build untouched. Before each change, save current function descriptions, env and IAM plus the previous Hosting release ID in a new TB ledger. Rollback redeploys those nine previous source snapshots/envs/identities and restores the previous Hosting release. The new image service can remain private/zero-minimum while paused. Preserve all Firestore and BQ data; no resource deletions are part of rollback.',
        'The earlier $20 allocation is exhausted/reserved. The additional $20 is a working ceiling, not a provider-enforced billing cap; record reservations and pause before it is exhausted. Do not run paid stages before the final approval.']
    return '\n'.join(lines) + '\n'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'deploy/config.local.toml')
    parser.add_argument('--output', type=Path, default=ROOT / '.deploy')
    parser.add_argument('--replace', action='store_true')
    args = parser.parse_args()
    try:
        generate(read_config(args.config), args.output, args.replace)
    except (ValueError, OSError, tomllib.TOMLDecodeError) as exc:
        parser.exit(2, f'Preparation failed: {exc}\nCopy deploy/config.example.toml to deploy/config.local.toml and review explicit models, emails and origins.\n')
    print(f'Local review artifacts generated: {args.output}. No cloud operations performed.')

if __name__ == '__main__':
    main()
