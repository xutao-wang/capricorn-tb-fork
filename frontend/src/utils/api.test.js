import { TextDecoder, TextEncoder } from 'util';
import { auth } from '../firebase';
import * as api from './api';
import {prepareClinicalCase} from './caseValidation';
jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
beforeEach(() => {
 global.TextDecoder = TextDecoder;
 auth.currentUser = { getIdToken: jest.fn().mockResolvedValue('fresh') };
 global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {}, redactedText: 'safe', analysis: {markdown_content: 'Synthetic synthesis'}, isClinicalCase: true, specialtyId: 'tuberculosis' }), text: async () => '"cavitation"', body: { getReader: () => ({ read: jest.fn().mockResolvedValueOnce({done:false,value:new TextEncoder().encode('{"type":"metadata","data":{"status":"complete"}}\n')}).mockResolvedValue({done:true}) }) } });
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

});
test('article stream preserves progress events', async () => {
 process.env.REACT_APP_RETRIEVE_ARTICLES_URL = '/articles';
 const read = jest.fn().mockResolvedValueOnce({ value: new TextEncoder().encode('{"type":"progress","count":1}\n{"type":"metadata","data":{"status":"complete"}}\n'), done: false }).mockResolvedValue({ done: true });
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

const articleStream = chunks => {
 const read = jest.fn();
 chunks.forEach(chunk => read.mockResolvedValueOnce({done:false,value:new TextEncoder().encode(chunk)}));
 read.mockResolvedValue({done:true});
 fetch.mockResolvedValue({ok:true,body:{getReader:()=>({read})}});
};
const complete = '{"type":"metadata","data":{"status":"complete"}}';
test('article stream handles arbitrary boundaries, blank CRLF lines, unicode, and final unterminated record',async()=>{
 articleStream(['{"type":"progress","text":"syn','thetic α"}\r\n\r\n'+complete.slice(0,20),complete.slice(20)]);
 const callback=jest.fn();
 await api.retrieveAndAnalyzeArticles('disease',[],'specialty',callback);
 expect(callback.mock.calls.map(([data])=>data)).toEqual([{type:'progress',text:'synthetic α'},{type:'metadata',data:{status:'complete'}}]);
});
test.each([
 ['error event',['{"type":"error","data":{"message":"private upstream body"}}\n']],
 ['truncated stream',['{"type":"progress"}\n']],
 ['malformed terminal',['{"type":"metadata","data":']],
])('article stream rejects %s safely',async(_,chunks)=>{
 articleStream(chunks);
 await expect(api.retrieveAndAnalyzeArticles('disease',[],'specialty',jest.fn())).rejects.toThrow(/Literature retrieval could not be completed/);
});
test('article stream awaits final callback and propagates callback rejection',async()=>{
 articleStream([complete+'\n']);
 let rejectCallback; const callback=jest.fn(()=>{const pending=new Promise((_,reject)=>{rejectCallback=reject;});pending.catch(()=>{});return pending;});
 let settled=false;
 const result=api.retrieveAndAnalyzeArticles('disease',[],'specialty',callback).finally(()=>{settled=true;});
 await new Promise(resolve=>setTimeout(resolve,0));
 const settledBeforeCallback=settled;
 expect(callback).toHaveBeenCalledTimes(1);
 rejectCallback(Error('Synthetic persistence failed'));
 await expect(result).rejects.toThrow('Synthetic persistence failed');
 expect(settledBeforeCallback).toBe(false);
});
test.each([{analysis:{}},{analysis:{markdown_content:''}},{success:false,analysis:{markdown_content:'not valid'}}])('final response requires successful nonempty markdown %#',async payload=>{
 fetch.mockResolvedValue({ok:true,json:async()=>payload});
 await expect(api.generateFinalAnalysis('case','disease',[],[],'specialty')).rejects.toThrow(/Final analysis could not be completed/);
});

test('retrieval request clamps its article count to one',async()=>{
 await api.retrieveAndAnalyzeArticles('disease',['event'],'specialty',()=>{},15);
 expect(JSON.parse(fetch.mock.calls[0][1].body).num_articles).toBe(1);
});


test('redaction adapter preserves authentication status through the real submission pipeline', async () => {
 process.env.REACT_APP_REDACT_URL='/local/redact';
 fetch.mockResolvedValue({ok:false,status:401});
 await expect(prepareClinicalCase('synthetic case', '', api)).rejects.toThrow(/Redaction failed.*HTTP 401.*sign in again/i);
 expect(fetch).toHaveBeenCalledTimes(1);
});


test('a late failed extraction sibling cannot broadcast over the submission-owned error', async () => {
 for (const name of ['REDACT','DETECT_SPECIALTY','EXTRACT_DISEASE','EXTRACT_EVENTS']) process.env[`REACT_APP_${name}_URL`]=`/local/${name}`;
 let rejectEvents;
 fetch.mockImplementation(async url => {
  if (url==='/local/REDACT') return {ok:true,json:async()=>({redactedText:'synthetic clinical context'})};
  if (url==='/local/DETECT_SPECIALTY') return {ok:true,json:async()=>({isClinicalCase:true,specialtyId:'tuberculosis'})};
  if (url==='/local/EXTRACT_DISEASE') return {ok:false,status:503};
  return new Promise(resolve=>{rejectEvents=()=>resolve({ok:false,status:503});});
 });
 const listener=jest.fn();
 window.addEventListener('capricorn-request-error', listener);
 try {
  await expect(prepareClinicalCase('synthetic case','',api)).rejects.toThrow(/Disease extraction failed.*HTTP 503/);
  rejectEvents();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(listener).not.toHaveBeenCalled();
 } finally { window.removeEventListener('capricorn-request-error',listener); }
});
