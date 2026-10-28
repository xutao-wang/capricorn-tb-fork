"""Regression cases for non-clinical input and fork-specific TB evidence handling."""
import inspect
import json
import os
from unittest import TestCase
from unittest.mock import patch
from flask import Flask, make_response, request
import test_backend_integration as integration
from test_backend_integration import BACKEND, load_source

class CaseValidationTests(TestCase):
    setUp = integration.BackendIntegrationTests.setUp

    def call(self, module, name, payload):
        with Flask('case-validation').test_request_context('/',method='POST',json=payload):
            return make_response(inspect.unwrap(getattr(module,name))(request))

    def test_general_question_cannot_generate_specialty(self):
        module=load_source('capricorn-detect-specialty')
        result={'isClinicalCase':False,'specialtyId':None,'confidence':0,'rationale':'No clinical case','suggestedLabel':'General Triage','suggestedDescription':'General questions'}
        with patch.object(module,'list_specialties',return_value=[]), patch.object(module,'_classify',return_value=result), patch.object(module,'_generate_persona') as generate:
            response=self.call(module,'detect_specialty',{'text':'who are you?'})
        self.assertEqual(response.status_code,422)
        self.assertEqual(response.json['code'],'NO_CLINICAL_CASE')
        generate.assert_not_called()

    def test_classifier_failure_cannot_generate_specialty(self):
        module=load_source('capricorn-detect-specialty')
        with patch.object(module,'list_specialties',return_value=[]),patch.object(module,'_call_gemini',side_effect=RuntimeError('synthetic private failure')),patch.object(module,'_generate_persona') as generate:
            response=self.call(module,'detect_specialty',{'text':'Synthetic case'})
        self.assertEqual(response.status_code,503)
        generate.assert_not_called()
        self.assertNotIn('synthetic private failure',response.get_data(as_text=True))

    def test_classifier_demands_boolean_clinical_flag(self):
        module=load_source('capricorn-detect-specialty')
        result={'specialtyId':'tuberculosis','isClinicalCase':'true','confidence':99,'rationale':'test'}
        with patch.object(module,'_call_gemini',return_value=json.dumps(result)):
            classified=module._classify([{'id':'tuberculosis','label':'Tuberculosis','description':'TB'}],'Synthetic case')
        self.assertIs(classified.get('isClinicalCase'),False)
        self.assertTrue(classified.get('error'))

    def test_valid_clinical_classifier_keeps_specialty(self):
        module=load_source('capricorn-detect-specialty')
        result={'specialtyId':'tuberculosis','isClinicalCase':True,'confidence':95,'rationale':'Synthetic TB case'}
        with patch.object(module,'_call_gemini',return_value=json.dumps(result)):
            classified=module._classify([{'id':'tuberculosis','label':'Tuberculosis','description':'TB'}],'Synthetic case')
        self.assertIs(classified.get('isClinicalCase'),True)
        self.assertEqual(classified['specialtyId'],'tuberculosis')

    def test_no_disease_prose_is_not_a_disease(self):
        module=load_source('pubmed-search-tester-extract-disease')
        module.client.models.generate_content.return_value.text='Unable to identify a disease from the provided text.'
        with patch.object(module,'get_specialty',return_value=json.loads((BACKEND/'specialties/general_medicine.json').read_text())):
            response=self.call(module,'extract_disease',{'text':'who are you?'})
        self.assertEqual(response.status_code,422)
        self.assertEqual(response.json['code'],'NO_CLINICAL_CASE')

    def test_no_events_prose_is_not_an_event(self):
        module=load_source('pubmed-search-tester-extract-events')
        module.client.models.generate_content.return_value.text='No actionable events identified.'
        with patch.object(module,'get_specialty',return_value=json.loads((BACKEND/'specialties/general_medicine.json').read_text())):
            response=self.call(module,'extract_events',{'text':'who are you?'})
        self.assertEqual(response.status_code,422)
        self.assertEqual(response.json['code'],'NO_ACTIONABLE_EVENTS')

    def test_confirmed_events_remain_quoted_terms(self):
        module=load_source('pubmed-search-tester-extract-events')
        module.client.models.generate_content.return_value.text='"Right upper lobe cavitation" "AFB smear positive"'
        with patch.object(module,'get_specialty',return_value=json.loads((BACKEND/'specialties/tuberculosis.json').read_text())):
            response=self.call(module,'extract_events',{'text':'Synthetic TB case'})
        self.assertEqual(response.status_code,200)
        self.assertIn('Right upper lobe cavitation',response.get_data(as_text=True))

    def test_rifampicin_alone_is_not_labeled_mdr_in_example(self):
        specialty=json.loads((BACKEND/'specialties/tuberculosis.json').read_text())
        example=specialty['diseaseExtraction']['fewShotExamples'][0]
        self.assertIn('rifampicin resistance',example['input'])
        self.assertIn('RR-TB',example['output'])
        self.assertNotIn('MDR-TB',example['output'])

    def test_tb_final_prompt_is_evidence_discussion(self):
        module=load_source('capricorn-final-analysis')
        specialty=json.loads((BACKEND/'specialties/tuberculosis.json').read_text())
        prompt=module.create_final_analysis_prompt('Synthetic case','Suspected pulmonary TB',['Cavitation'],[],specialty)
        self.assertNotIn('tumor board',prompt.lower())
        self.assertNotIn('cancer type:',prompt.lower())
        self.assertIn('no supporting article',prompt.lower())
        self.assertIn('laboratory',prompt.lower())
        self.assertIn('Suspected pulmonary TB',prompt)

    def article_fixture(self, specialty):
        domain=specialty['articleScoring']['domainFilterField']['key']
        return {'article_metadata':{'title':'Synthetic article','journal_title':'Synthetic Journal','year':'2026','paper_type':'Clinical Study','condition':'Pulmonary TB','actionable_events':[],domain:True,'journal_sjr':99}}

    def test_sjr_is_deterministic_and_catalog_not_in_prompt(self):
        module=load_source('capricorn-retrieve-full-articles')
        specialty=json.loads((BACKEND/'specialties/tuberculosis.json').read_text())
        module.journal_impact_lookup={'synthetic journal':2.5,'private_catalog_sentinel':9}
        module.journal_impact_data={'PRIVATE_CATALOG_SENTINEL':9}
        module.client.models.generate_content.return_value.text=json.dumps(self.article_fixture(specialty))
        result=module.analyze_with_gemini('Synthetic public article','PMC123',specialty,'Pulmonary TB','Cavitation')
        self.assertEqual(result['article_metadata']['journal_sjr'],2.5)
        sent=module.client.models.generate_content.call_args.kwargs['contents'][0].parts[0].text
        self.assertNotIn('PRIVATE_CATALOG_SENTINEL',sent)

    def test_missing_domain_flag_does_not_become_true(self):
        module=load_source('capricorn-retrieve-full-articles')
        specialty=json.loads((BACKEND/'specialties/tuberculosis.json').read_text())
        fixture=self.article_fixture(specialty)
        fixture['article_metadata'].pop(specialty['articleScoring']['domainFilterField']['key'])
        module.client.models.generate_content.return_value.text=json.dumps(fixture)
        self.assertIsNone(module.analyze_with_gemini('Synthetic article','PMC123',specialty,'Pulmonary TB','Cavitation'))

    def test_all_failed_articles_do_not_emit_successful_completion(self):
        module=load_source('capricorn-retrieve-full-articles')
        module.bq_client.query.return_value.result.return_value=[{'pmc_id':'PMC123','pmid':'123','article_text':'Synthetic article'}]
        with patch.object(module,'analyze_with_gemini',return_value=None):
            messages=[json.loads(line) for line in module.stream_response('Cavitation',{},'Pulmonary TB',1)]
        self.assertTrue(any(m['type']=='error' for m in messages))
        self.assertFalse(any(m.get('data',{}).get('status')=='complete' for m in messages))
