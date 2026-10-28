import {handleSendMessage} from './messageHandlers';
import * as api from '../../utils/api';
import {createNewChat,addMessageToChat} from '../../firebase';
jest.mock('../../firebase',()=>({createNewChat:jest.fn(async()=> 'synthetic-chat'),addMessageToChat:jest.fn()}));
jest.mock('../../utils/api',()=>({redactSensitiveInfo:jest.fn(),streamChat:jest.fn(),retrieveAndAnalyzeArticles:jest.fn()}));
beforeEach(()=>jest.clearAllMocks());
const args=()=>({e:{preventDefault(){}},message:'research synthetic private text',setMessage:jest.fn(),user:{uid:'synthetic'},setActiveChat:jest.fn(),setChatHistory:jest.fn(),setIsLoadingDocs:jest.fn(),setIsLoadingAnalysis:jest.fn()});
test('follow-up streams redacted text and research keywords do not trigger literature',async()=>{api.redactSensitiveInfo.mockResolvedValue('safe research text');await handleSendMessage(args());expect(api.streamChat.mock.calls[0][0]).toBe('safe research text');expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();});
test('redaction failure stops persistence and model calls',async()=>{api.redactSensitiveInfo.mockRejectedValue(Error('private'));await handleSendMessage(args());expect(createNewChat).not.toHaveBeenCalled();expect(addMessageToChat).not.toHaveBeenCalled();expect(api.streamChat).not.toHaveBeenCalled();});
