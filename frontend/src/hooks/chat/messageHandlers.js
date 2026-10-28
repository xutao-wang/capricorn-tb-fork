// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createNewChat, addMessageToChat } from '../../firebase';
import { streamChat, redactSensitiveInfo } from '../../utils/api';
import { getLatestMessages } from './utils';

export const createMessageId = (type) => `${Date.now()}-${type}-${Math.random().toString(36).substr(2, 9)}`;

export const handleSendMessage = ({
  e,
  message,
  setMessage,
  user,
  activeChat,
  setActiveChat,
  setChatHistory,
  isLoadingDocs,
  setIsLoadingDocs,
  isLoadingAnalysis,
  setIsLoadingAnalysis,
  userId,
  selectedSpecialtyId
}) => {
  // Handle both event objects and direct message objects
  if (e && e.preventDefault) {
    e.preventDefault();
  }

  // If e is a message object with type 'analysis' or 'document', update the existing conversation
  if (typeof e === 'object' && (e.type === 'analysis' || e.type === 'document')) {
    return handleAnalysisOrDocumentMessage({
      e,
      user,
      activeChat,
      setActiveChat,
      setChatHistory,
      setIsLoadingAnalysis,
      userId
    });
  }

  // Handle regular user messages
  const userMessage = typeof e === 'object' && e.content ? e.content : message;

  if ((typeof e === 'object' && e.content) || (message.trim() && !isLoadingDocs && !isLoadingAnalysis)) {
    setMessage(''); // Clear the message state immediately
    return handleUserMessage({
      userMessage,
      user,
      activeChat,
      setActiveChat,
      setChatHistory,
      setIsLoadingDocs,
      setIsLoadingAnalysis,
      userId,
      setMessage, // Pass setMessage to handleUserMessage
      selectedSpecialtyId
    });
  }
};

const handleAnalysisOrDocumentMessage = async ({
  e,
  user,
  activeChat,
  setActiveChat,
  setChatHistory,
  setIsLoadingAnalysis,
  userId
}) => {
  try {
    let currentChatId = activeChat?.id;
    let messagesForFirestore = [...(activeChat?.messages || [])];

    if (!currentChatId) {
      const initialMessages = [];
      currentChatId = await createNewChat(user?.uid || userId, initialMessages);
      setActiveChat({ id: currentChatId, messages: initialMessages });
    }

    if (e.type === 'document' || e.type === 'analysis') {
      if (e.type === 'analysis' && e.content?.isLoading) {
        setIsLoadingAnalysis(true);
        return;
      }

      const latestMessages = await getLatestMessages(user?.uid || userId, currentChatId);
      const timestamp = new Date();
      const messageId = createMessageId(e.type);

      const newMessage = createMessage(e, messageId, timestamp);
      const firestoreMessage = createFirestoreMessage(e, messageId, timestamp);

      if (e.type === 'analysis' && !e.content?.isLoading) {
        setIsLoadingAnalysis(false);
      }

      setChatHistory(prev => [...prev, newMessage]);

      latestMessages.push(firestoreMessage);
      await addMessageToChat(user?.uid || userId, currentChatId, latestMessages);
      setActiveChat(current => ({
        ...current,
        messages: latestMessages
      }));
    }
  } catch (error) {

  }
};

const handleUserMessage = async ({
  userMessage,
  user,
  activeChat,
  setActiveChat,
  setChatHistory,
  setIsLoadingDocs,
  setIsLoadingAnalysis,
  userId,
  setMessage,
  selectedSpecialtyId
}) => {
  setMessage(''); // Clear the message input immediately
  // Redact sensitive information from user message
  let redactedMessage;
  try {
    redactedMessage = await redactSensitiveInfo(userMessage);
  } catch (error) {

    window.dispatchEvent(new CustomEvent('capricorn-request-error',{detail:'Redaction failed. Message was not submitted.'}));
    return;
  }
  try {
    let currentChatId = activeChat?.id;
    let messagesForFirestore = [];

    if (!currentChatId) {
      const initialMessages = [];
      currentChatId = await createNewChat(user?.uid || userId, initialMessages);
      setActiveChat({ id: currentChatId, messages: initialMessages });
    }

    messagesForFirestore = [...(activeChat?.messages || [])];
    const newUserMessage = {
      content: redactedMessage, // Store redacted version
      role: 'user',
      timestamp: new Date(),
      type: 'message',
      messageId: createMessageId('user')
    };
    messagesForFirestore.push(newUserMessage);

    const newMessage = {
      id: createMessageId('user'),
      text: redactedMessage, // Display redacted version
      isUser: true,
      timestamp: new Date()
    };
    setChatHistory(prev => [...prev, newMessage]);

    await addMessageToChat(user?.uid || userId, currentChatId, messagesForFirestore);

    // Create assistant message placeholder for streaming
    const assistantMessageId = createMessageId('assistant');
    const assistantMessage = {
      id: assistantMessageId,
      text: '',
      isUser: false,
      timestamp: new Date()
    };

    setChatHistory(prev => [...prev, assistantMessage]);

      // Stream the response

      let accumulatedText = '';

      await streamChat(
        redactedMessage,
        user?.uid || userId,
        currentChatId,
        (chunk) => {

          accumulatedText += chunk;
          setChatHistory(prev => {
            const newHistory = [...prev];
            const assistantMessageIndex = newHistory.findIndex(msg => msg.id === assistantMessageId);
            if (assistantMessageIndex !== -1) {

              newHistory[assistantMessageIndex] = {
                ...newHistory[assistantMessageIndex],
                text: accumulatedText
              };

            } else {

            }
            return newHistory;
          });
        },
        selectedSpecialtyId
      );


      // Update Firestore with the complete message
      if (accumulatedText) {
        const finalAssistantMessage = {
          content: accumulatedText,
          role: 'assistant',
          timestamp: new Date(),
          type: 'message',
          messageId: assistantMessageId
        };
        messagesForFirestore.push(finalAssistantMessage);
        await addMessageToChat(user?.uid || userId, currentChatId, messagesForFirestore);
      }
  } catch (error) {
    window.dispatchEvent(new CustomEvent('capricorn-request-error',{detail:'Message processing failed. Please try again.'}));
  }
};

const createMessage = (e, messageId, timestamp) => {
  if (e.type === 'document') {
    return {
      id: messageId,
      type: 'document',
      isUser: false,
      currentProgress: e.content.currentProgress,
      articles: e.content.articles,
      timestamp
    };
  }
  return {
    id: messageId,
    isUser: false,
    analysis: e.content,
    timestamp
  };
};

const createFirestoreMessage = (e, messageId, timestamp) => ({
  content: e.type === 'document' ? JSON.stringify(e.content) : e.content,
  role: 'assistant',
  timestamp,
  type: e.type,
  messageId
});
