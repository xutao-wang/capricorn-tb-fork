"""Strict image draft contract; no output is promoted into fabricated findings."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

IMAGE_DIR = Path(__file__).resolve().parents[1] / 'capricorn-analyze-image'
sys.path.insert(0, str(IMAGE_DIR))
if (IMAGE_DIR / 'findings.py').exists():
    import findings
else:
    findings = None


def valid_findings():
    return {
        'modality': 'CXR', 'technicalQuality': 'adequate',
        'findings': [{'name': name, 'status': 'indeterminate', 'location': None,
                      'description': 'Not established from this image'} for name in
                     ['cavitation', 'consolidation', 'bilateral_extent', 'miliary_pattern']],
        'summaryText': 'Draft research observations',
    }


class FindingsTests(unittest.TestCase):
    def validate(self, value):
        if findings is None:
            # The fork accepts arbitrary parsed JSON without schema validation.
            return json.loads(value)
        return findings.validate_findings(value)

    def test_valid_contract_keeps_explicit_unknowns(self):
        value = valid_findings()
        self.assertEqual(self.validate(json.dumps(value)), value)

    def test_missing_core_findings_and_duplicate_core_findings_rejected(self):
        for mutate in (lambda v: v['findings'].pop(),
                       lambda v: v['findings'].__setitem__(0, v['findings'][1].copy())):
            value = valid_findings()
            mutate(value)
            with self.assertRaises(ValueError):
                self.validate(json.dumps(value))

    def test_invalid_enum_types_extra_fields_empty_summary_rejected(self):
        for field, invalid in [('modality', 'XRAY'), ('modality', None),
                               ('technicalQuality', True), ('summaryText', ''),
                               ('summaryText', 4), ('diagnosis', 'unsupported')]:
            value = valid_findings()
            value[field] = invalid
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate(json.dumps(value))
        for field, invalid in [('status', 'maybe'), ('status', False),
                               ('location', []), ('description', 42), ('name', 'unknown')]:
            value = valid_findings()
            value['findings'][0][field] = invalid
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate(json.dumps(value))

    def test_invalid_json_and_no_output_never_fabricate_findings(self):
        for value in ('{', '', 'null', '[]', '```json\n{}\n```'):
            with self.subTest(length=len(value)), self.assertRaises(ValueError):
                self.validate(value)

    def test_uninterpretable_image_cannot_assert_positive_or_negative_findings(self):
        value = valid_findings()
        value['technicalQuality'] = 'uninterpretable'
        for row in value['findings']:
            row['status'] = 'not_assessable'
        self.assertEqual(self.validate(json.dumps(value)), value)
        value['findings'][0]['status'] = 'present'
        with self.assertRaises(ValueError):
            self.validate(json.dumps(value))

    def test_actionable_events_derive_only_from_present_phenotype_names(self):
        self.assertIsNotNone(findings, 'strict findings module is required')
        value = valid_findings()
        value['findings'][0].update(status='present', location='Right upper zone',
                                   description='Candidate visible cavity')
        value['findings'][1].update(status='absent')
        self.assertEqual(findings.actionable_events(value), ['Cavitation'])
        value['technicalQuality'] = 'uninterpretable'
        self.assertEqual(findings.actionable_events(value), [])


if __name__ == '__main__':
    unittest.main()
