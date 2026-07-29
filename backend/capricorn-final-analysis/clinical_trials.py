"""Fetches candidate clinical trials from ClinicalTrials.gov for the patient's
disease and each actionable event, then uses Gemini to screen each candidate
trial's eligibility criteria against the specific patient case -- one batched
Gemini call per event, not per trial (Option B from the implementation plan).

ClinicalTrials.gov's API v2 is U.S. government public data with no
AI-usage restriction (unlike, e.g., NCCN's licensed guideline content), and
costs nothing to call. The only real cost here is the small number of
Gemini screening calls. See docs/clinical-trial-agent-plan.md at the repo
root.
"""
import json
import logging
import os
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from google.genai import types

logger = logging.getLogger(__name__)

CTGOV_BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
ACTIVE_STATUSES = "RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING"
REQUESTED_FIELDS = "NCTId,BriefTitle,OverallStatus,Phase,EligibilityCriteria,MinimumAge,MaximumAge,BriefSummary"

MAX_TRIALS_PER_EVENT = int(os.environ.get('MAX_TRIALS_PER_EVENT', 8))
CLINICAL_TRIALS_MODEL = os.environ.get('CLINICAL_TRIALS_MODEL', 'gemini-3.1-flash-lite')
CTGOV_TIMEOUT_SECONDS = 15


def _ctgov_request(params):
    url = f"{CTGOV_BASE_URL}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=CTGOV_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        return data.get('studies', [])
    except Exception as e:
        logger.error(f"ClinicalTrials.gov request failed for {params}: {e}")
        return []


def _simplify_study(study):
    section = study.get('protocolSection', {})
    identification = section.get('identificationModule', {})
    status = section.get('statusModule', {})
    description = section.get('descriptionModule', {})
    design = section.get('designModule', {})
    eligibility = section.get('eligibilityModule', {})

    return {
        'nctId': identification.get('nctId'),
        'briefTitle': identification.get('briefTitle', ''),
        'overallStatus': status.get('overallStatus', ''),
        'phase': ', '.join(design.get('phases', []) or []) or 'N/A',
        'briefSummary': description.get('briefSummary', ''),
        'eligibilityCriteria': eligibility.get('eligibilityCriteria', ''),
        'minimumAge': eligibility.get('minimumAge'),
        'maximumAge': eligibility.get('maximumAge'),
    }


def _is_pediatric_specialty(specialty):
    """Coarse heuristic (id/label contains "pediatric") rather than parsing
    articleScoring.fields for a population-focus key -- the schema has no
    dedicated top-level flag for this, and this is good enough to avoid
    surfacing adult-only trials as top matches for a pediatric case."""
    haystack = f"{specialty.get('id', '')} {specialty.get('label', '')}".lower()
    return 'pediatric' in haystack


def _age_in_years(age_str):
    """Parses ClinicalTrials.gov's free-text age field (e.g. "18 Years",
    "6 Months") into a float number of years, or None if unparseable/absent."""
    if not age_str:
        return None
    parts = age_str.split()
    if len(parts) != 2:
        return None
    try:
        value = float(parts[0])
    except ValueError:
        return None
    unit = parts[1].lower()
    if unit.startswith('month'):
        return value / 12
    if unit.startswith('week'):
        return value / 52
    if unit.startswith('day'):
        return value / 365
    return value  # assume years


def _excludes_pediatric_patients(trial):
    """A trial excludes pediatric patients if its minimum enrollment age is
    18+ -- i.e. it has no pediatric arm at all, not just that it also
    accepts adults."""
    min_age_years = _age_in_years(trial.get('minimumAge'))
    return min_age_years is not None and min_age_years >= 18


def fetch_candidate_trials(disease, events, specialty=None):
    """Returns {event: [simplified_trial_dict, ...]}. Fetches one broad
    disease-level pool plus one query per event, merges the disease-level
    pool into an event's candidates when the event keyword appears in that
    trial's title/summary, and caps each event's list at
    MAX_TRIALS_PER_EVENT.

    For pediatric specialties, adult-only trials (minimumAge >= 18, no
    pediatric arm) are filtered out after fetching, rather than pushing an
    age constraint into the query string -- ClinicalTrials.gov's Essie
    query-term syntax for age ranges proved fragile (a malformed clause
    silently zeroed out every result rather than erroring loudly), so
    filtering on the already-parsed minimumAge field in Python is more
    robust than relying on that syntax being exactly right."""
    pediatric = specialty is not None and _is_pediatric_specialty(specialty)

    def query(term):
        # query.term is ClinicalTrials.gov's free-text search field.
        # Deliberately NOT using query.cond here -- that field only matches
        # against their controlled condition-name vocabulary (short canonical
        # names like "AML"), and silently returns zero results for the more
        # qualified/precise disease phrasing the extraction step produces on
        # purpose (e.g. "KMT2A-rearranged AML"). This bit us in testing: the
        # same case worked when disease was manually set to "AML" but
        # returned nothing once the real extraction pipeline produced the
        # qualified phrase, because query.cond was being ANDed onto every
        # single query, including the per-event ones.
        params = {
            'query.term': term,
            'filter.overallStatus': ACTIVE_STATUSES,
            'pageSize': MAX_TRIALS_PER_EVENT * 2,
            'fields': REQUESTED_FIELDS,
        }
        studies = [_simplify_study(s) for s in _ctgov_request(params)]
        if pediatric:
            studies = [s for s in studies if not _excludes_pediatric_patients(s)]
        return studies

    disease_level = query(disease)

    results = {}
    for event in events:
        event_specific = query(event)
        merged = {t['nctId']: t for t in event_specific if t['nctId']}
        for trial in disease_level:
            if not trial['nctId'] or trial['nctId'] in merged:
                continue
            haystack = f"{trial['briefTitle']} {trial['briefSummary']}".lower()
            if event.lower() in haystack:
                merged[trial['nctId']] = trial
        results[event] = list(merged.values())[:MAX_TRIALS_PER_EVENT]

    return results


def _extract_json_array(text):
    cleaned = text.strip()
    if '```json' in cleaned:
        cleaned = cleaned.split('```json')[1].split('```')[0].strip()
    elif '[' in cleaned and ']' in cleaned:
        start = cleaned.find('[')
        end = cleaned.rfind(']') + 1
        cleaned = cleaned[start:end]
    return json.loads(cleaned)


def build_eligibility_prompt(case_notes, disease, event, trials):
    trials_block = "\n\n".join(
        f"""NCT ID: {t['nctId']}
Title: {t['briefTitle']}
Status: {t['overallStatus']} | Phase: {t['phase']} | Age range: {t.get('minimumAge') or 'N/A'} - {t.get('maximumAge') or 'N/A'}
Brief Summary: {t['briefSummary']}
Eligibility Criteria:
{t['eligibilityCriteria']}
{'-' * 60}"""
        for t in trials
    )

    return f"""You are screening clinical trials for eligibility against a specific patient case.

Patient case notes:
\"\"\"
{case_notes}
\"\"\"
Disease: {disease}
Actionable event being screened: {event}

Candidate trials:
{trials_block}

For EACH trial above, determine whether this patient likely qualifies based on the eligibility criteria and the case notes. Return ONLY a raw JSON array, one object per trial, in the same order as listed. Do not include any explanatory text, markdown formatting, or code blocks.
[
  {{
    "nctId": "...",
    "verdict": "likely_eligible" | "possibly_eligible" | "likely_ineligible" | "insufficient_info",
    "matchedCriteria": ["..."],
    "concerns": ["..."],
    "rationale": "one sentence"
  }}
]"""


def screen_trials_for_event(case_notes, disease, event, trials, client):
    if not trials:
        return []

    prompt = build_eligibility_prompt(case_notes, disease, event, trials)
    config = types.GenerateContentConfig(
        temperature=0.2,
        top_p=0.95,
        max_output_tokens=4096,
        safety_settings=[
            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
        ],
    )

    try:
        response = client.models.generate_content(
            model=CLINICAL_TRIALS_MODEL,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
            config=config,
        )
        verdicts = _extract_json_array(response.text)
    except Exception as e:
        logger.error(f"Trial screening failed for event '{event}': {e}")
        return []

    # Attach the trial's own metadata (title/phase/status) back onto each
    # verdict so the final-analysis prompt has everything it needs without
    # a second lookup.
    trials_by_id = {t['nctId']: t for t in trials}
    enriched = []
    for v in verdicts:
        trial = trials_by_id.get(v.get('nctId'))
        if trial:
            enriched.append({**v, 'briefTitle': trial['briefTitle'], 'phase': trial['phase'], 'overallStatus': trial['overallStatus']})
    return enriched


def screen_all_events(case_notes, disease, events, specialty, client):
    """Returns {event: [verdict_dict, ...]}. Fetches candidates for every
    event, then runs the per-event screening calls concurrently -- these
    are independent requests, no reason to pay for them sequentially on
    top of the final-analysis call that follows. Any event whose fetch or
    screening fails contributes an empty list rather than raising, so a
    ClinicalTrials.gov or Gemini hiccup never blocks the tumor-board report."""
    try:
        candidates_by_event = fetch_candidate_trials(disease, events, specialty)
    except Exception as e:
        logger.error(f"fetch_candidate_trials failed entirely: {e}")
        return {}

    results = {}
    with ThreadPoolExecutor(max_workers=max(len(events), 1)) as executor:
        future_to_event = {
            executor.submit(screen_trials_for_event, case_notes, disease, event, candidates_by_event.get(event, []), client): event
            for event in events
        }
        for future in as_completed(future_to_event):
            event = future_to_event[future]
            try:
                results[event] = future.result()
            except Exception as e:
                logger.error(f"Screening future failed for event '{event}': {e}")
                results[event] = []

    return results
