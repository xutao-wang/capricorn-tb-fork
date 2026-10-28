import {getDoc} from 'firebase/firestore';
import {handleSendMessage} from './messageHandlers';
import * as api from '../../utils/api';
import {getLatestMessages} from './utils';
import {createNewChat,addMessageToChat} from '../../firebase';
jest.mock('../../firebase',()=>({createNewChat:jest.fn(async()=> 'synthetic-chat'),addMessageToChat:jest.fn()}));
jest.mock('../../utils/api',()=>({redactSensitiveInfo:jest.fn(),streamChat:jest.fn(),retrieveAndAnalyzeArticles:jest.fn()}));
jest.mock('firebase/firestore',()=>({doc:jest.fn(),getDoc:jest.fn()}));
jest.mock('./utils',()=>({getLatestMessages:jest.fn(async()=>[])}));
beforeEach(()=>{jest.clearAllMocks();getLatestMessages.mockResolvedValue([]);});
const args=()=>({e:{preventDefault(){}},message:'research synthetic private text',setMessage:jest.fn(),user:{uid:'synthetic'},setActiveChat:jest.fn(),setChatHistory:jest.fn(),setIsLoadingDocs:jest.fn(),setIsLoadingAnalysis:jest.fn()});
test('follow-up streams redacted text and research keywords do not trigger literature',async()=>{api.redactSensitiveInfo.mockResolvedValue('safe research text');await handleSendMessage(args());expect(api.streamChat.mock.calls[0][0]).toBe('safe research text');expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();});
test('redaction failure stops persistence and model calls',async()=>{api.redactSensitiveInfo.mockRejectedValue(Error('private'));await handleSendMessage(args());expect(createNewChat).not.toHaveBeenCalled();expect(addMessageToChat).not.toHaveBeenCalled();expect(api.streamChat).not.toHaveBeenCalled();});

test('document persistence failure rejects without claiming document completion',async()=>{
 addMessageToChat.mockRejectedValueOnce(Error('Synthetic persistence failed'));
 const input={...args(),activeChat:{id:'synthetic-chat'},e:{type:'document',content:{articles:[],currentProgress:'complete'}}};
 await expect(handleSendMessage(input)).rejects.toThrow('Synthetic persistence failed');
 expect(input.setChatHistory).not.toHaveBeenCalled();
});
test('failed latest-message read cannot overwrite existing persisted conversation',async()=>{
 getLatestMessages.mockRejectedValueOnce(Error('Synthetic read failed'));
 const input={...args(),activeChat:{id:'synthetic-chat'},e:{type:'document',content:{articles:[]}}};
 await expect(handleSendMessage(input)).rejects.toThrow();
 expect(addMessageToChat).not.toHaveBeenCalled();
});

test('latest-message read failure rejects safely instead of returning an empty conversation',async()=>{
 getDoc.mockRejectedValueOnce(Error('private database body'));
 const {getLatestMessages:readLatest}=jest.requireActual('./utils');
 await expect(readLatest('synthetic-owner','synthetic-chat')).rejects.toThrow('Conversation could not be read. Please try again.');
});
