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
    r"not (?:a |enough |sufficient )?(?:clinical|medical|provided|specified|available)\b|"
    r"i\s+(?:cannot|can't|could not|am unable|am an?\b)|sorry\b|"
    r"the (?:provided|input|text|request)\b|this (?:input|text|request)\b|"
    r"insufficient\s+(?:clinical|medical|information)\b)",
    re.IGNORECASE,
)


def _missing(value):
    return (not isinstance(value, str) or not value.strip()
            or value.strip().lower().rstrip('.!') in {'none', 'null', 'n/a', 'unknown', 'not applicable', '[]'}
            or bool(_NO_RESULT.match(value.strip())))


def disease_result(raw):
    if isinstance(raw, str):
        raw = raw.strip()
    if isinstance(raw, str) and raw.startswith(('{', '[', '"')):
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                raw = (payload.get('disease')
                       if payload.get('success', True) is True
                       and payload.get('isClinicalCase', True) is True
                       and not payload.get('error') else None)
            else:
                raw = payload if isinstance(payload, str) else None
        except (ValueError, AttributeError):
            raw = None
    if isinstance(raw, str):
        # Normalize the complete representation before checking semantic failure.
        for _ in range(3):
            if len(raw) >= 2 and (raw[0], raw[-1]) in {("'", "'"), ('"', '"'), ('“', '”')}:
                raw = raw[1:-1].strip()
            else:
                break
    if _missing(raw) or len(raw.strip()) > 256 or '\n' in raw.strip():
        raise ExtractionValidationError(
            'No disease or suspected condition was identified. Provide clinical case notes or reviewed findings.',
            'NO_CLINICAL_CASE')
    return raw.strip()


def event_results(raw):
    values = []
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str):
        text = raw.strip()
        if text.startswith(('[', '{')):
            try:
                payload = json.loads(text)
                if isinstance(payload, dict):
                    values = (payload.get('events', [])
                              if payload.get('success', True) is True
                              and payload.get('isClinicalCase', True) is True
                              and not payload.get('error') else [])
                else:
                    values = payload
            except ValueError:
                values = []
        elif not _missing(text):
            # Legacy prompts return a sequence of quoted terms. Prose is not a term.
            decoder = json.JSONDecoder()
            while text:
                try:
                    value, end = decoder.raw_decode(text)
                    if not isinstance(value, str):
                        raise ValueError('Expected a complete sequence of quoted terms')
                    values.append(value)
                    text = text[end:].strip()
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
