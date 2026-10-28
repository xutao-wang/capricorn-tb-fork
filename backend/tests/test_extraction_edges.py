"""Regression cases from independent backend review; all inputs are synthetic."""
import json
import unittest
from unittest.mock import patch
from flask import Flask,make_response,request
import test_backend_integration as integration
from test_backend_integration import load_source
from capricorn_runtime.clinical import disease_result,event_results,ExtractionValidationError

class ExtractionEdgeTests(unittest.TestCase):
    def test_entire_disease_value_is_normalized_before_validation(self):
        for text in ['""','"unknown"','"Unable to identify a disease from the provided text."',"'No disease identified.'",'I cannot determine a diagnosis from this request.','The provided text contains no clinical disease.','Sorry, I cannot identify a condition.']:
            with self.subTest(text=text):
                with self.assertRaises(ExtractionValidationError):disease_result(text)

    def test_failure_envelopes_cannot_become_events(self):
        for payload in [{'success':False,'events':['Cavitation']},{'success':'true','events':['Cavitation']},{'isClinicalCase':False,'events':['Cavitation']},{'error':'Synthetic error','events':['Cavitation']}]:
            with self.subTest(payload=payload):
                with self.assertRaises(ExtractionValidationError):event_results(json.dumps(payload))

    def test_prose_surrounding_quoted_text_is_not_an_event_sequence(self):
        for text in ['The input "who are you?" does not describe clinical events.','"Cavitation" and nothing else','No findings: "none"']:
            with self.subTest(text=text):
                with self.assertRaises(ExtractionValidationError):event_results(text)

    def test_complete_valid_event_representations_still_work(self):
        self.assertEqual(event_results('"Cavitation" "AFB smear positive"'),['Cavitation','AFB smear positive'])
        self.assertEqual(event_results('["Cavitation"]'),['Cavitation'])
        self.assertEqual(event_results('{"success":true,"events":["Cavitation"]}'),['Cavitation'])
        self.assertEqual(disease_result('"Pulmonary tuberculosis"'),'Pulmonary tuberculosis')

class ClassifierEdgeTests(unittest.TestCase):
    setUp=integration.BackendIntegrationTests.setUp

    def classify_response(self, module, data, generate):
        known=[{'id':'tuberculosis','label':'TB','description':'TB'}]
        with patch.object(module,'list_specialties',return_value=known),patch.object(module,'_call_gemini',return_value=json.dumps(data)),patch.object(module,'_generate_persona',generate):
            with Flask('classifier-edge').test_request_context('/',method='POST',json={'text':'Synthetic case'}):
                import inspect
                return make_response(inspect.unwrap(module.detect_specialty)(request))

    def test_invalid_or_incomplete_classification_never_generates_persona(self):
        module=load_source('capricorn-detect-specialty')
        known=[{'id':'tuberculosis','label':'TB','description':'TB'}]
        baseline={'isClinicalCase':True,'specialtyId':'tuberculosis','confidence':99}
        variants=[{**baseline,'specialtyId':'nonexistent'},{**baseline,'specialtyId':123},{k:v for k,v in baseline.items() if k!='confidence'},{k:v for k,v in baseline.items() if k!='specialtyId'}]
        for data in variants:
            with self.subTest(data=data),patch.object(module,'list_specialties',return_value=known),patch.object(module,'_call_gemini',return_value=json.dumps(data)),patch.object(module,'_generate_persona',return_value=None) as generate:
                with Flask('classifier-edge').test_request_context('/',method='POST',json={'text':'Synthetic case'}):
                    import inspect
                    response=make_response(inspect.unwrap(module.detect_specialty)(request))
                self.assertEqual(response.status_code,502)
                self.assertEqual(response.json['code'],'INVALID_CLASSIFICATION')
                generate.assert_not_called()

    def test_invalid_confidence_never_generates_persona(self):
        from unittest.mock import MagicMock
        module=load_source('capricorn-detect-specialty')
        for confidence in [None,True,'99',float('nan'),float('inf'),-1,101,10**400]:
            with self.subTest(confidence=confidence):
                generate=MagicMock()
                response=self.classify_response(module,{'isClinicalCase':True,'specialtyId':'tuberculosis','confidence':confidence},generate)
                self.assertEqual(response.status_code,502)
                self.assertEqual(response.json['code'],'INVALID_CLASSIFICATION')
                generate.assert_not_called()

    def test_explicit_null_requires_nonempty_string_suggestions(self):
        from unittest.mock import MagicMock
        module=load_source('capricorn-detect-specialty')
        baseline={'isClinicalCase':True,'specialtyId':None,'confidence':0,'suggestedLabel':'Synthetic specialty','suggestedDescription':'Synthetic clinical scope'}
        for key in ['suggestedLabel','suggestedDescription']:
            variants=[{k:v for k,v in baseline.items() if k!=key}]
            variants.extend({**baseline,key:value} for value in [None,'','  ',123])
            for data in variants:
                with self.subTest(key=key,value=data.get(key)):
                    generate=MagicMock(return_value=None)
                    response=self.classify_response(module,data,generate)
                    self.assertEqual(response.status_code,502)
                    self.assertEqual(response.json['code'],'INVALID_CLASSIFICATION')
                    generate.assert_not_called()

    def test_valid_explicit_null_can_generate_persona(self):
        from unittest.mock import MagicMock
        module=load_source('capricorn-detect-specialty')
        generate=MagicMock(return_value={'id':'synthetic-specialty','label':'Synthetic specialty'})
        data={'isClinicalCase':True,'specialtyId':None,'confidence':0,'suggestedLabel':'Synthetic specialty','suggestedDescription':'Synthetic clinical scope'}
        response=self.classify_response(module,data,generate)
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json['generated'])
        self.assertEqual(generate.call_args.args[2:],('Synthetic specialty','Synthetic clinical scope'))

    def test_explicit_nonclinical_result_never_generates_persona(self):
        from unittest.mock import MagicMock
        module=load_source('capricorn-detect-specialty')
        generate=MagicMock()
        response=self.classify_response(module,{'isClinicalCase':False,'specialtyId':None,'confidence':0},generate)
        self.assertEqual(response.status_code,422)
        self.assertEqual(response.json['code'],'NO_CLINICAL_CASE')
        generate.assert_not_called()
