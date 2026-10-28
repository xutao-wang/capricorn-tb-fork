import {renderHook,act} from '@testing-library/react';
import useChat from './useChat';
import {addMessageToChat,createNewChat} from '../firebase';
import {redactSensitiveInfo,streamChat} from '../utils/api';
jest.mock('../firebase',()=>({createNewChat:jest.fn(),addMessageToChat:jest.fn()}));
jest.mock('../utils/api',()=>({redactSensitiveInfo:jest.fn(),streamChat:jest.fn()}));
beforeEach(()=>{
 createNewChat.mockResolvedValue('synthetic-chat');
 addMessageToChat.mockResolvedValue();
 redactSensitiveInfo.mockResolvedValue('Synthetic safe message');
 streamChat.mockImplementation(async(_text,_owner,_chat,onChunk)=>onChunk('Synthetic assistant response'));
});
test('creating a chat during a message keeps subsequent assistant updates in that same operation',async()=>{
 const {result}=renderHook(()=>useChat({uid:'synthetic-owner'},'tuberculosis'));
 let deliver;
 streamChat.mockImplementation((_text,_owner,_chat,onChunk)=>new Promise(resolve=>{deliver=()=>{onChunk('Synthetic assistant response');resolve();};}));
 let pending;
 await act(async()=>{pending=result.current.handleSendMessage({content:'Synthetic message'});});
 await act(async()=>{deliver();await pending;});
 expect(result.current.activeChat.id).toBe('synthetic-chat');
 expect(result.current.chatHistory.map(message=>message.text)).toEqual(['Synthetic safe message','Synthetic assistant response']);
});
