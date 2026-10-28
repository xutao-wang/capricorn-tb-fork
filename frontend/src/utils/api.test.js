import { TextDecoder, TextEncoder } from 'util';
import { auth } from '../firebase';
import * as api from './api';
jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
beforeEach(() => {
 global.TextDecoder = TextDecoder;
 auth.currentUser = { getIdToken: jest.fn().mockResolvedValue('fresh') };
 global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {}, redactedText: 'safe', analysis: 'analysis', isClinicalCase: true, specialtyId: 'tuberculosis' }), text: async () => '"cavitation"', body: { getReader: () => ({ read: async () => ({ done: true }) }) } });
});
test.each([
 ['ANALYZE_IMAGE', () => api.analyzeMedicalImage('synthetic','test.png','tuberculosis')],
 ['CHAT', () => api.streamChat('message','uid','chat',() => {},'specialty')],
 ['REDACT', () => api.redactSensitiveInfo('case')],
 ['PROCESS_LAB', () => api.processLabPDF('pdf')],
 ['RETRIEVE_ARTICLES', () => api.retrieveAndAnalyzeArticles('disease',['event'],'specialty',() => {},15)],
 ['FINAL_ANALYSIS', () => api.generateFinalAnalysis('case','disease',[],[],'specialty')],
 ['FEEDBACK', () => api.sendFeedback({ feedback: 'feedback' })],
 ['EXTRACT_DISEASE', () => api.extractDisease('case','specialty')],
 ['EXTRACT_EVENTS', () => api.extractEvents('case','specialty')],
 ['DETECT_SPECIALTY', () => api.detectSpecialty('case')],
])('%s uses configured endpoint and authenticated requests', async (name, call) => {
 process.env[`REACT_APP_${name}_URL`] = `/local/${name}`;
 await call();
 expect(fetch.mock.calls[0][0]).toBe(`/local/${name}`);
 expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer fresh');
 if(name === 'RETRIEVE_ARTICLES') expect(JSON.parse(fetch.mock.calls[0][1].body).num_articles).toBe(1);
});
test('article stream preserves progress events', async () => {
 process.env.REACT_APP_RETRIEVE_ARTICLES_URL = '/articles';
 const read = jest.fn().mockResolvedValueOnce({ value: new TextEncoder().encode('{"type":"progress","count":1}\n'), done: false }).mockResolvedValue({ done: true });
 fetch.mockResolvedValue({ ok: true, body: { getReader: () => ({ read }) } });
 const onProgress = jest.fn(); await api.retrieveAndAnalyzeArticles('disease',[],'specialty',onProgress);
 expect(onProgress).toHaveBeenCalledWith({ type: 'progress', count: 1 });
});
test('image request keeps the exact authenticated image contract',async()=>{
 process.env.REACT_APP_ANALYZE_IMAGE_URL='/local/image';
 const data={reviewRequired:true,parsedFindings:{modality:'CT_SLICE',technicalQuality:'limited',findings:[]},previewImage:'data:image/jpeg;base64,c3ludGhldGlj'};
 fetch.mockResolvedValue({ok:true,json:async()=>({success:true,data})});
 expect(await api.analyzeMedicalImage('synthetic-bytes','selected-slice.dcm','tuberculosis')).toEqual(data);
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({image_data:'synthetic-bytes',file_name:'selected-slice.dcm',specialty_id:'tuberculosis'});
});
test('signed-out image analysis cannot send pixels to network',async()=>{
 process.env.REACT_APP_ANALYZE_IMAGE_URL='/local/image';auth.currentUser=null;
 await expect(api.analyzeMedicalImage('synthetic-bytes','synthetic.png')).rejects.toThrow(/sign in/i);
 expect(fetch).not.toHaveBeenCalled();
});
test.each([['EXTRACT_EVENTS','No actionable events identified.'],['EXTRACT_DISEASE','Error extracting disease.']])('successful HTTP cannot turn %s failure prose into a case',async(name,text)=>{
 process.env[`REACT_APP_${name}_URL`]='/local/extract';fetch.mockResolvedValue({ok:true,text:async()=>text});
 await expect(name==='EXTRACT_EVENTS'?api.extractEvents('synthetic'):api.extractDisease('synthetic')).rejects.toThrow();
});
