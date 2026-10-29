import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import MedicalAssistantUI from './MedicalAssistantUI';
import * as api from './utils/api';
import {getSpecialtyById} from './firebase';
import {initializeActiveChat} from './hooks/useChat';
jest.mock('./hooks/useAuth',()=>({useAuth:()=>({user:{uid:'synthetic'},loading:false,isAuthenticated:true})}));
jest.mock('./hooks/useChat',()=>{const initializeActiveChat=jest.fn();return {__esModule:true,initializeActiveChat,default:(()=>{const state={chatHistory:[],setMessage:jest.fn(),initializeActiveChat,initializeNewChat:jest.fn()};return ()=>state;})()};});
jest.mock('./firebase',()=>({getSpecialtyById:jest.fn(async()=>({id:'tb'}))}));
jest.mock('./utils/api',()=>({redactSensitiveInfo:jest.fn(async t=>t),detectSpecialty:jest.fn(),extractDisease:jest.fn(),extractEvents:jest.fn(),retrieveAndAnalyzeArticles:jest.fn()}));
jest.mock('./components/ExpandableSidebar',()=>({WrappedExpandableSidebar:()=>null}));
jest.mock('./components/TopBar',()=>()=>null);
jest.mock('./components/Feedback/FeedbackButton',()=>()=>null);
jest.mock('./components/Feedback/FeedbackModal',()=>()=>null);
jest.mock('./components/IntendedUseModal',()=>()=>null);
jest.mock('./components/MainPanel/MainPanel',()=>props=><div><button onClick={()=>props.handleExtract('whoar eyou','')}>Intro</button><button onClick={()=>props.handleExtract('synthetic case','')}>Extract</button><button onClick={()=>props.handleRetrieve()}>Retrieve</button><span>{props.extractedDisease}</span>{props.detectedSpecialtyConfig && <span>Evidence weights available</span>}{props.extractedEvents.map(e=><span key={e}>{e}</span>)}</div>);
beforeEach(()=>{jest.clearAllMocks();api.redactSensitiveInfo.mockImplementation(async text=>text);getSpecialtyById.mockResolvedValue({id:'tb'});});
test('introduction stays local without creating chat, weights, or search',async()=>{render(<MedicalAssistantUI/>);fireEvent.click(screen.getByText('Intro'));await screen.findByText(/I am Capricorn/);expect(api.redactSensitiveInfo).not.toHaveBeenCalled();expect(api.detectSpecialty).not.toHaveBeenCalled();expect(initializeActiveChat).not.toHaveBeenCalled();expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();});
test.each(['No actionable events found.','Error processing request'])('invalid events cannot initialize chat or retrieval: %s',async events=>{api.detectSpecialty.mockResolvedValue({isClinicalCase:true,specialtyId:'tb'});api.extractDisease.mockResolvedValue('Tuberculosis');api.extractEvents.mockResolvedValue(events);render(<MedicalAssistantUI/>);fireEvent.click(screen.getByText('Extract'));await waitFor(()=>expect(api.extractEvents).toHaveBeenCalled());await screen.findByRole('alert');expect(initializeActiveChat).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Retrieve'));expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();expect(screen.queryByText('Tuberculosis')).not.toBeInTheDocument();});
test('valid extraction still cannot fetch papers before weights confirmation',async()=>{api.detectSpecialty.mockResolvedValue({isClinicalCase:true,specialtyId:'tb'});api.extractDisease.mockResolvedValue('Tuberculosis');api.extractEvents.mockResolvedValue(['cavitation']);render(<MedicalAssistantUI/>);fireEvent.click(screen.getByText('Extract'));await waitFor(()=>expect(initializeActiveChat).toHaveBeenCalled());fireEvent.click(screen.getByText('Retrieve'));expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();});


test.each([
  [{ isClinicalCase: false, disease: 'Tuberculosis' }, ['cavitation']],
  ['Tuberculosis', { isClinicalCase: false, events: ['cavitation'] }],
  ['No diagnosis', ['cavitation']],
  ['Tuberculosis', { events: ['No diagnosis'] }],
  ['Tuberculosis', { events: ['not applicable'] }],
])('nonclinical extraction response %# cannot initialize a case or expose weights', async (disease, events) => {
  api.detectSpecialty.mockResolvedValue({ isClinicalCase: true, specialtyId: 'tb' });
  api.extractDisease.mockResolvedValue(disease);
  api.extractEvents.mockResolvedValue(events);

  render(<MedicalAssistantUI />);
  fireEvent.click(screen.getByText('Extract'));
  await screen.findByRole('alert');

  expect(initializeActiveChat).not.toHaveBeenCalled();
  expect(getSpecialtyById).not.toHaveBeenCalled();
  expect(screen.queryByText('Evidence weights available')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Retrieve'));
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
});

test('dotted clinical terms initialize a case but still require evidence-weight confirmation', async () => {
  api.detectSpecialty.mockResolvedValue({ isClinicalCase: true, specialtyId: 'tb' });
  api.extractDisease.mockResolvedValue({ disease: 'C. difficile infection' });
  api.extractEvents.mockResolvedValue({ events: ['BRAF p.V600E'] });

  render(<MedicalAssistantUI />);
  fireEvent.click(screen.getByText('Extract'));
  await waitFor(() => expect(initializeActiveChat).toHaveBeenCalledWith(
    'synthetic case', '', 'C. difficile infection', ['BRAF p.V600E'],
  ));

  expect(screen.getByText('Evidence weights available')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Retrieve'));
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
});


test('submission displays the failed extraction stage without exposing server details', async () => {
 api.detectSpecialty.mockResolvedValue({isClinicalCase:true,specialtyId:'tb'});
 api.extractDisease.mockResolvedValue('Tuberculosis');
 api.extractEvents.mockRejectedValue(Object.assign(new Error('private server details'), {status:503}));
 render(<MedicalAssistantUI/>);
 fireEvent.click(screen.getByText('Extract'));
 const alert=await screen.findByRole('alert');
 expect(alert).toHaveTextContent(/Actionable-finding extraction failed.*HTTP 503/i);
 expect(alert).not.toHaveTextContent('private server details');
 expect(initializeActiveChat).not.toHaveBeenCalled();
});

test('missing specialty configuration has its own error instead of blaming the case', async () => {
 api.detectSpecialty.mockResolvedValue({isClinicalCase:true,specialtyId:'tb'});
 api.extractDisease.mockResolvedValue('Tuberculosis');
 api.extractEvents.mockResolvedValue(['cavitation']);
 getSpecialtyById.mockResolvedValue(null);
 render(<MedicalAssistantUI/>);
 fireEvent.click(screen.getByText('Extract'));
 expect(await screen.findByRole('alert')).toHaveTextContent(/Evidence weights could not be loaded/i);
 expect(initializeActiveChat).not.toHaveBeenCalled();
});
