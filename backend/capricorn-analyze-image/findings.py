"""Strict, draft-only image phenotype contract; no text fallback or diagnosis."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

FindingName = Literal['cavitation', 'consolidation', 'bilateral_extent', 'miliary_pattern']
CORE_FINDINGS = {'cavitation', 'consolidation', 'bilateral_extent', 'miliary_pattern'}
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1024)]


class Finding(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    name: FindingName
    status: Literal['present', 'absent', 'indeterminate', 'not_assessable']
    location: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)] | None
    description: ShortText


class ImageFindings(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    modality: Literal['CXR', 'CT_SLICE', 'UNKNOWN']
    technicalQuality: Literal['adequate', 'limited', 'uninterpretable']
    findings: list[Finding] = Field(min_length=4, max_length=4)
    summaryText: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)]

    @model_validator(mode='after')
    def validate_core_states(self):
        if {finding.name for finding in self.findings} != CORE_FINDINGS:
            raise ValueError('Each core phenotype must appear exactly once')
        if self.technicalQuality == 'uninterpretable' and any(
                finding.status != 'not_assessable' for finding in self.findings):
            raise ValueError('Uninterpretable images require not_assessable findings')
        return self


def validate_findings(text):
    if not isinstance(text, str) or not text or len(text) > 16384:
        raise ValueError('Vision model returned no valid structured findings')
    try:
        return ImageFindings.model_validate_json(text).model_dump()
    except ValueError:
        # Validation details may contain model text; never expose or log them.
        raise ValueError('Vision model returned invalid structured findings') from None


def actionable_events(document):
    """Candidate phenotype labels for review, derived only from positive states.

    Model prose is never accepted as an event, preventing diagnosis/treatment
    language from being propagated into the event list.
    """
    if document['technicalQuality'] == 'uninterpretable':
        return []
    labels = {'cavitation': 'Cavitation', 'consolidation': 'Consolidation',
              'bilateral_extent': 'Visible bilateral involvement', 'miliary_pattern': 'Miliary pattern'}
    return [labels[item['name']] for item in document['findings'] if item['status'] == 'present']
