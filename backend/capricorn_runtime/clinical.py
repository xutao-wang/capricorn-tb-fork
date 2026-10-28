"""Validate extraction responses without converting failure prose into clinical facts."""
import json
import re

from .config import positive_int


class ExtractionValidationError(ValueError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


_NO_RESULT = re.compile(
    r"^(?:unable\b|cannot\b|can't\b|could not\b|there (?:is|are) no\b|"
    r"no (?:specific |identifiable |clear )?(?:disease|diagnosis|condition|medical|clinical|actionable|events?|findings?)\b|"
    r"not (?:a |enough |sufficient )?(?:clinical|medical|provided|specified|available)\b)",
    re.IGNORECASE,
)


def _missing(value):
    return (not isinstance(value, str) or not value.strip()
            or value.strip().lower().rstrip('.!') in {'none', 'null', 'n/a', 'unknown', 'not applicable', '[]'}
            or bool(_NO_RESULT.match(value.strip())))


def disease_result(raw):
    if isinstance(raw, str) and raw.strip().startswith('{'):
        try:
            payload = json.loads(raw)
            raw = payload.get('disease') if payload.get('success', True) is True else None
        except (ValueError, AttributeError):
            raw = None
    if _missing(raw) or len(raw.strip()) > 256 or '\n' in raw.strip():
        raise ExtractionValidationError(
            'No disease or suspected condition was identified. Provide clinical case notes or reviewed findings.',
            'NO_CLINICAL_CASE')
    return raw.strip().strip('"')


def event_results(raw):
    values = []
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str):
        text = raw.strip()
        if text.startswith(('[', '{')):
            try:
                payload = json.loads(text)
                values = payload.get('events', []) if isinstance(payload, dict) else payload
            except ValueError:
                values = []
        elif not _missing(text):
            # Legacy prompts return a sequence of quoted terms. Prose is not a term.
            for match in re.findall(r'"((?:\\.|[^"\\])*)"', text):
                try:
                    values.append(json.loads('"' + match + '"'))
                except ValueError:
                    values = []
                    break
    if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
        values = []
    cleaned = list(dict.fromkeys(v.strip() for v in values
                                if not _missing(v) and len(v.strip()) <= 2000))
    if not cleaned:
        raise ExtractionValidationError(
            'No actionable findings were identified. Add relevant clinical details or reviewed image findings.',
            'NO_ACTIONABLE_EVENTS')
    if len(cleaned) > positive_int('MAX_EVENTS', 10):
        raise ExtractionValidationError('The extracted findings exceed the configured event limit.',
                                        'INVALID_EXTRACTION')
    return cleaned
