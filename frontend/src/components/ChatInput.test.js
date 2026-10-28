import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import ChatInput from './ChatInput';
import {redactSensitiveInfo} from '../utils/api';
jest.mock('../utils/api',()=>({redactSensitiveInfo:jest.fn()}));
test('submits current follow-up text to the single redaction boundary',()=>{const send=jest.fn();render(<ChatInput message="" setMessage={()=>{}} handleSendMessage={send}/>);fireEvent.change(screen.getByPlaceholderText('Ask questions here...'),{target:{value:'synthetic new question'}});fireEvent.keyDown(screen.getByPlaceholderText('Ask questions here...'),{key:'Enter'});expect(send).toHaveBeenCalledWith({content:'synthetic new question'});expect(redactSensitiveInfo).not.toHaveBeenCalled();});
