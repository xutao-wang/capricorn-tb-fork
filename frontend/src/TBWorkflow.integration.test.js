import React from 'react';
import { TextDecoder, TextEncoder } from 'util';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicalAssistantUI from './MedicalAssistantUI';
import * as api from './utils/api';
import { addMessageToChat, createNewChat, getSpecialtyById, getUserWeightPresets, getChatMessages, auth } from './firebase';
import { onSnapshot, getDoc } from 'firebase/firestore';

jest.mock('./hooks/useAuth', () => {
  const user = { uid: 'synthetic-owner', isAnonymous: false };
  return { useAuth: () => ({ user, loading: false, isAuthenticated: true }) };
});
jest.mock('./firebase', () => ({
  auth: { currentUser: { uid: 'synthetic-owner', isAnonymous: false, getIdToken: jest.fn(async()=> 'synthetic-token') } },
  db: {},
  createNewChat: jest.fn(),
  addMessageToChat: jest.fn(),
  getSpecialtyById: jest.fn(),
  getUserWeightPresets: jest.fn(),
  getChatMessages: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  onSnapshot: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(async () => ({ exists: () => true, data: () => ({messages: mockPersistedMessages}) })),
}));
jest.mock('./utils/api', () => ({
  analyzeMedicalImage: jest.fn(),
  redactSensitiveInfo: jest.fn(),
  detectSpecialty: jest.fn(),
  extractDisease: jest.fn(),
  extractEvents: jest.fn(),
  retrieveAndAnalyzeArticles: jest.fn(),
  generateFinalAnalysis: jest.fn(),
}));
// Decorative/navigation/rendering boundaries are unrelated to the workflow.
// MainPanel, CaseInputSection, RadiologyFindingsCard, useChat/chatState,
// ChatContainer, and EvidenceWeightsReview all remain real.
jest.mock('./components/ExpandableSidebar', () => ({ WrappedExpandableSidebar: props => <><button onClick={props.initializeNewChat}>New synthetic case</button><button onClick={()=>props.onChatSelect({id:'synthetic-chat'})}>Select saved synthetic case</button></> }));
jest.mock('./components/TopBar', () => () => null);
jest.mock('./components/Feedback/FeedbackButton', () => () => null);
jest.mock('./components/Feedback/FeedbackModal', () => () => null);
jest.mock('./components/IntendedUseModal', () => () => null);
jest.mock('./components/ChatMessage', () => {
  const React = require('react');
  return React.forwardRef(() => null);
});
jest.mock('./components/MarkdownRenderer', () => ({content}) => <div>{content}</div>);
jest.mock('react-markdown', () => () => null);

let mockPersistedMessages = [];
const imageDraft = {
  parsedFindings: {
    modality: 'CXR',
    technicalQuality: 'adequate',
    findings: [
      { name: 'cavitation', status: 'present', location: 'right upper lung', description: 'Synthetic candidate phenotype' },
      { name: 'consolidation', status: 'indeterminate', location: null, description: 'Not established from this synthetic fixture' },
      { name: 'bilateral_extent', status: 'absent', location: null, description: 'Not observed in this synthetic fixture' },
      { name: 'miliary_pattern', status: 'not_assessable', location: null, description: 'Not assessable in this synthetic fixture' },
    ],
    summaryText: 'Draft research observations',
  },
  summaryText: 'Draft research observations',
  actionableEvents: ['cavitation'],
  metadata: { Format: 'PNG', OriginalDimensions: '256x256', PreviewDimensions: '256x256' },
  previewImage: 'data:image/jpeg;base64,c3ludGhldGljLXByZXZpZXc=',
  reviewRequired: true,
  model: 'gemini-3.8-flash',
};
const specialty = {
  id: 'tuberculosis',
  label: 'Synthetic research specialty',
  articleScoring: {
    fields: [{ key: 'clinicalRelevance', label: 'Clinical relevance', points: 10 }],
    perMatchedEventPoints: 1,
    journalImpactMultiplier: 1,
    yearDecayRate: 1,
    clinicalTrialBonus: 1,
    reviewPenalty: 1,
    citationImpactMultiplier: 1,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.currentUser.getIdToken.mockResolvedValue('synthetic-token');
  getDoc.mockImplementation(async()=>({exists:()=>true,data:()=>({messages:mockPersistedMessages.map(message=>({...message}))})}));
  Element.prototype.scrollIntoView = jest.fn();
  addMessageToChat.mockResolvedValue();
  api.generateFinalAnalysis.mockResolvedValue({markdown_content: 'Synthetic final synthesis'});
  global.fetch = jest.fn(() => Promise.reject(new Error('Unexpected network request')));
  onSnapshot.mockReturnValue(() => {});
  mockPersistedMessages = [];
  createNewChat.mockImplementation(async (_owner,messages)=>{mockPersistedMessages=messages;return 'synthetic-chat';});
  addMessageToChat.mockImplementation(async (_owner,_chat,messages)=>{mockPersistedMessages=messages;});
  getChatMessages.mockImplementation(async()=>mockPersistedMessages);
  getSpecialtyById.mockResolvedValue(specialty);
  getUserWeightPresets.mockResolvedValue([]);
  api.redactSensitiveInfo.mockImplementation(async text => text.replace('synthetic private identifier', '[REDACTED]'));
  api.detectSpecialty.mockResolvedValue({ isClinicalCase: true, specialtyId: 'tuberculosis', label: specialty.label });
  api.extractDisease.mockResolvedValue({ disease: 'Tuberculosis' });
  api.extractEvents.mockResolvedValue({ events: ['cavitation', 'BRAF p.V600E'] });
});

test('reviewed four-finding image and confirmed weights permit exactly one retrieval without persisting pixels', async () => {
  let finishImage;
  let finishRetrieval;
  api.analyzeMedicalImage.mockReturnValue(new Promise(resolve => { finishImage = resolve; }));
  api.retrieveAndAnalyzeArticles.mockReturnValue(new Promise(resolve => { finishRetrieval = resolve; }));

  render(<MedicalAssistantUI />);
  fireEvent.change(screen.getByLabelText('Case notes'), {
    target: { value: 'Synthetic clinical case with synthetic private identifier and BRAF p.V600E' },
  });
  fireEvent.click(screen.getByRole('button', { name: /upload.*cxr/i }));
  fireEvent.change(screen.getByLabelText(/select imaging file/i), {
    target: { files: [new File(['synthetic-image-bytes'], 'synthetic.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(api.analyzeMedicalImage).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Submit case' })).toBeDisabled();
  expect(api.redactSensitiveInfo).not.toHaveBeenCalled();
  expect(api.detectSpecialty).not.toHaveBeenCalled();
  expect(api.extractEvents).not.toHaveBeenCalled();
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  expect(createNewChat).not.toHaveBeenCalled();

  await act(async () => finishImage(imageDraft));
  await screen.findByRole('heading', { name: /draft imaging observations/i });
  expect(screen.getByText(/consolidation: indeterminate/)).toBeInTheDocument();
  expect(screen.getByText(/miliary pattern: not_assessable/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Reviewed positive phenotypes'), {
    target: { value: 'cavitation in clinician-reviewed right upper lung' },
  });
  expect(screen.getByRole('button', { name: 'Submit case' })).toBeDisabled();
  expect(api.redactSensitiveInfo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /confirm reviewed findings/i }));
  expect(api.extractEvents).not.toHaveBeenCalled();
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit case' }));

  const continueButton = await screen.findByRole('button', { name: 'Continue to fetch papers' });
  expect(api.redactSensitiveInfo).toHaveBeenCalledTimes(1);
  expect(api.detectSpecialty).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'), {reportError:false});
  expect(api.extractEvents).toHaveBeenCalledWith(
    expect.stringContaining('cavitation in clinician-reviewed right upper lung'), 'tuberculosis', {reportError:false},
  );
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  expect(createNewChat).toHaveBeenCalledTimes(1);
  const [owner, messages] = createNewChat.mock.calls[0];
  expect(owner).toBe('synthetic-owner');
  const persistedCase = JSON.parse(messages[0].content);
  expect(persistedCase.caseNotes).toContain('[REDACTED]');
  expect(persistedCase.caseNotes).toContain('cavitation in clinician-reviewed right upper lung');
  expect(persistedCase.extractedEvents).toEqual(['cavitation', 'BRAF p.V600E']);
  expect(persistedCase.reviewedImageProvenance).toEqual({model:'gemini-3.8-flash',modality:'CXR',technicalQuality:'adequate',rendering:{Format:'PNG',OriginalDimensions:'256x256',PreviewDimensions:'256x256'}});

  fireEvent.click(continueButton);
  await waitFor(() => expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1));
  expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledWith(
    'Tuberculosis', ['cavitation', 'BRAF p.V600E'], 'tuberculosis', expect.any(Function), 1,
    expect.objectContaining({ clinicalRelevance: 10 }),
  );
  await act(async () => finishRetrieval());
  expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1);

  const persistedPayload = JSON.stringify([...createNewChat.mock.calls, ...addMessageToChat.mock.calls]);
  expect(persistedPayload).not.toContain('synthetic private identifier');
  expect(persistedPayload).not.toContain('data:image');
  expect(persistedPayload).not.toContain(imageDraft.previewImage.split(',')[1]);
  expect(persistedPayload).not.toContain(btoa('synthetic-image-bytes'));
  expect(persistedPayload).not.toContain('previewImage');
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['classification', 'typed events'])('reviewed image cannot turn nonclinical %s into a persisted case or weights', async failureStage => {
  api.analyzeMedicalImage.mockResolvedValue(imageDraft);
  if (failureStage === 'classification') {
    api.detectSpecialty.mockResolvedValue({ isClinicalCase: false, specialtyId: 'tuberculosis' });
  } else {
    api.extractEvents.mockResolvedValue({ isClinicalCase: false, events: ['cavitation'] });
  }

  render(<MedicalAssistantUI />);
  fireEvent.change(screen.getByLabelText('Case notes'), { target: { value: 'Synthetic clinical fixture' } });
  fireEvent.click(screen.getByRole('button', { name: /upload.*cxr/i }));
  fireEvent.change(screen.getByLabelText(/select imaging file/i), {
    target: { files: [new File(['synthetic-image-bytes'], 'synthetic.png', { type: 'image/png' })] },
  });
  await screen.findByRole('heading', { name: /draft imaging observations/i });
  fireEvent.click(screen.getByRole('button', { name: /confirm reviewed findings/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit case' }));
  await screen.findByRole('alert');

  expect(createNewChat).not.toHaveBeenCalled();
  expect(addMessageToChat).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Continue to fetch papers' })).not.toBeInTheDocument();
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

async function startRetrieval() {
 render(<MedicalAssistantUI />);
 fireEvent.change(screen.getByLabelText('Case notes'),{target:{value:'Synthetic clinical case'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));
 const continueButton=await screen.findByRole('button',{name:'Continue to fetch papers'});
 // Flush the asynchronous retrieval callback as well as the click itself.
 fireEvent.click(continueButton);
 await act(async()=>{await Promise.resolve();});
 await waitFor(()=>expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1));
}
const articleEvent={type:'article_analysis',data:{analysis:{article_metadata:{PMCID:'PMC123',title:'Synthetic evidence',overall_points:10,actionable_events:['cavitation'],point_breakdown:{},journal_title:'Synthetic journal',year:2026},full_article_text:'Synthetic article'},progress:{article_number:1,total_articles:1}}};
const terminal={type:'metadata',data:{status:'complete'}};
function completedRetrieval() {
 api.retrieveAndAnalyzeArticles.mockImplementation(async(_d,_e,_s,onMessage)=>{await onMessage(articleEvent);await onMessage(terminal);});
}
test('real completion callback persists documents and synthesis before allowing completion and blocks repeated search',async()=>{
 completedRetrieval();
 let finishFinal;
 api.generateFinalAnalysis.mockReturnValue(new Promise(resolve=>{finishFinal=resolve;}));
 await startRetrieval();
 await screen.findByText('Preparing final analysis...');
 expect(screen.getByText('Paper retrieval complete')).toBeInTheDocument();
 expect(api.generateFinalAnalysis).toHaveBeenCalledTimes(1);
 await act(async()=>finishFinal({markdown_content:'Synthetic final synthesis'}));
 await screen.findByText('Synthetic final synthesis');
 expect(screen.queryByText('Preparing final analysis...')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Expand paper retrieval options'}));
 const refetch=screen.getByRole('button',{name:'Re-fetch'});
 expect(refetch).toBeDisabled();fireEvent.click(refetch);
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1);
 expect(addMessageToChat.mock.calls.some(([, ,messages])=>messages.some(m=>m.type==='document'))).toBe(true);
});
test.each(['rejected','missing markdown'])('final %s clears loading, persists safe error, and retries synthesis using existing articles',async failure=>{
 completedRetrieval();
 if(failure==='rejected')api.generateFinalAnalysis.mockRejectedValueOnce(Error('private upstream body'));
 else api.generateFinalAnalysis.mockResolvedValueOnce({});
 await startRetrieval();
 await screen.findByRole('button',{name:'Retry final analysis'});
 expect(screen.queryByText('Preparing final analysis...')).not.toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('Final analysis could not be completed');
 expect(screen.queryByText('private upstream body')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry final analysis'}));
 await screen.findByText('Synthetic final synthesis');
 expect(api.generateFinalAnalysis).toHaveBeenCalledTimes(2);
 expect(api.generateFinalAnalysis.mock.calls[1][3]).toEqual([expect.objectContaining({pmcid:'PMC123'})]);
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.queryByText('Preparing final analysis...')).not.toBeInTheDocument();
});
test('failed retrieval exposes a manual retry without silently starting another search',async()=>{
 api.retrieveAndAnalyzeArticles.mockRejectedValueOnce(Error('private upstream body')).mockImplementation(async(_d,_e,_s,onMessage)=>{await onMessage(articleEvent);await onMessage(terminal);});
 await startRetrieval();
 await screen.findByText('Error retrieving articles. Please try again.');
 expect(api.generateFinalAnalysis).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Expand paper retrieval options'}));
 fireEvent.click(screen.getByRole('button',{name:'Re-fetch'}));
 await screen.findByText('Synthetic final synthesis');
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(2);
});

test('actual stream adapter and UI callback stay busy through final persistence',async()=>{
 global.TextDecoder=TextDecoder;
 process.env.REACT_APP_RETRIEVE_ARTICLES_URL='/synthetic-articles';
 api.retrieveAndAnalyzeArticles.mockImplementation(jest.requireActual('./utils/api').retrieveAndAnalyzeArticles);
 const read=jest.fn().mockResolvedValueOnce({done:false,value:new TextEncoder().encode(JSON.stringify(articleEvent)+'\n'+JSON.stringify(terminal)+'\n')}).mockResolvedValue({done:true});
 global.fetch.mockResolvedValue({ok:true,body:{getReader:()=>({read})}});
 let persistFinal;
 addMessageToChat.mockImplementation(async(_owner,_chat,messages)=>{
   if(messages.some(message=>message.type==='analysis'))await new Promise(resolve=>{persistFinal=resolve;});
   mockPersistedMessages=messages;
 });
 await startRetrieval();
 await waitFor(()=>expect(persistFinal).toEqual(expect.any(Function)));
 expect(await screen.findByText('Preparing final analysis...')).toBeInTheDocument();
 expect(screen.queryByText('Synthetic final synthesis')).not.toBeInTheDocument();
 await act(async()=>{persistFinal();await api.retrieveAndAnalyzeArticles.mock.results[0].value;});
 await screen.findByText('Synthetic final synthesis');
 expect(mockPersistedMessages.map(message=>message.type)).toEqual(['initial_case','document','analysis']);
 expect(screen.queryByText('Preparing final analysis...')).not.toBeInTheDocument();
 expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('final persistence failure is visible and final-only retry preserves document evidence',async()=>{
 completedRetrieval();
 const persist=addMessageToChat.getMockImplementation();
 addMessageToChat.mockImplementation(async(...args)=>{
  if(args[2].some(message=>message.type==='analysis')){addMessageToChat.mockImplementation(persist);throw Error('private storage failure');}
  return persist(...args);
 });
 await startRetrieval();
 await screen.findByRole('button',{name:'Retry final analysis'});
 expect(screen.queryByText('Preparing final analysis...')).not.toBeInTheDocument();
 expect(screen.queryByText('Synthetic final synthesis')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry final analysis'}));
 await screen.findByText('Synthetic final synthesis');
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1);
 expect(mockPersistedMessages.map(message=>message.type)).toEqual(['initial_case','document','analysis']);
});

test('new case clears completed retrieval and permits its own single search',async()=>{
 completedRetrieval();await startRetrieval();await screen.findByText('Synthetic final synthesis');
 fireEvent.click(screen.getByRole('button',{name:'New synthetic case'}));
 expect(screen.queryByText('Paper retrieval complete')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Case notes'),{target:{value:'Second synthetic clinical case'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));
 fireEvent.click(await screen.findByRole('button',{name:'Continue to fetch papers'}));
 await screen.findByText('Synthetic final synthesis');
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(2);
});
test('late final response from previous case cannot enter a new chat',async()=>{
 completedRetrieval();let finishFinal;
 api.generateFinalAnalysis.mockReturnValue(new Promise(resolve=>{finishFinal=resolve;}));
 await startRetrieval();await screen.findByText('Preparing final analysis...');
 fireEvent.click(screen.getByRole('button',{name:'New synthetic case'}));
 await act(async()=>finishFinal({markdown_content:'Old synthetic synthesis'}));
 expect(screen.getByLabelText('Case notes')).toHaveValue('');
 expect(screen.queryByText('Old synthetic synthesis')).not.toBeInTheDocument();
 expect(screen.queryByText('Paper retrieval complete')).not.toBeInTheDocument();
 expect(mockPersistedMessages.some(message=>message.type==='analysis')).toBe(false);
});
test('reloaded completed evidence supports final-only recovery in its own specialty',async()=>{
 completedRetrieval();api.generateFinalAnalysis.mockRejectedValueOnce(Error('synthetic failure'));
 await startRetrieval();await screen.findByRole('button',{name:'Retry final analysis'});
 fireEvent.click(screen.getByRole('button',{name:'Select saved synthetic case'}));
 await screen.findByText('Paper retrieval complete');
 fireEvent.click(screen.getByRole('button',{name:'Retry final analysis'}));
 await screen.findByText('Synthetic final synthesis');
 expect(api.generateFinalAnalysis.mock.calls[1][4]).toBe('tuberculosis');
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('explicit new case can finish its own workflow while an older final request settles',async()=>{
 completedRetrieval();let finishOld;
 api.generateFinalAnalysis.mockReturnValueOnce(new Promise(resolve=>{finishOld=resolve;}));
 await startRetrieval();await screen.findByText('Preparing final analysis...');
 fireEvent.click(screen.getByRole('button',{name:'New synthetic case'}));
 fireEvent.change(screen.getByLabelText('Case notes'),{target:{value:'Second synthetic clinical case'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));
 fireEvent.click(await screen.findByRole('button',{name:'Continue to fetch papers'}));
 await screen.findByText('Synthetic final synthesis');
 expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(2);
 await act(async()=>finishOld({markdown_content:'Old synthetic synthesis'}));
 expect(screen.queryByText('Old synthetic synthesis')).not.toBeInTheDocument();
 expect(screen.getByText('Synthetic final synthesis')).toBeInTheDocument();
});
test('historical failure prose without clinical classification cannot show extraction success or enable search',async()=>{
 const oldMessages=[{type:'initial_case',messageId:'old-case',timestamp:new Date(),content:JSON.stringify({caseNotes:'Synthetic old case',labResults:'',extractedDisease:'Error extracting disease.',extractedEvents:['No actionable events identified.']})}];
 getChatMessages.mockResolvedValue(oldMessages);
 render(<MedicalAssistantUI/>);
 fireEvent.click(screen.getByRole('button',{name:'Select saved synthetic case'}));
 await screen.findByRole('heading',{name:'Case extraction pending'});
 expect(screen.queryByText('Specialty identified, disease and actionable events extracted')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Continue to fetch papers'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Expand paper retrieval options'}));
 expect(screen.getByRole('button',{name:'Re-fetch'})).toBeDisabled();
 expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
 expect(createNewChat).not.toHaveBeenCalled();
});
