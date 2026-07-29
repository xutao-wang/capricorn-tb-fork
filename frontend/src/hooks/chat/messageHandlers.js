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
import { retrieveAndAnalyzeArticles, streamChat, redactSensitiveInfo } from '../../utils/api';
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
    console.error('Error handling message:', error);
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
    console.error('Error redacting message:', error);
    redactedMessage = userMessage; // Fallback to original message if redaction fails
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

    // If this is a document analysis request, proceed with article analysis
    if (redactedMessage.toLowerCase().includes('analyze') || redactedMessage.toLowerCase().includes('research')) {
      setIsLoadingDocs(true);
      try {
        await retrieveAndAnalyzeArticles(
          redactedMessage,
          [],  // events array
          undefined,
          async (data) => {
            if (data.type === 'analysis') {
              await handleAnalysisData(data, user, currentChatId, setChatHistory, setActiveChat, setIsLoadingAnalysis, userId);
            } else if (data.type === 'pmcids') {
              await handlePmcidsData(data, user, currentChatId, setChatHistory, setActiveChat, setIsLoadingAnalysis, userId);
            }
          }
        );
      } catch (error) {
        await handleAnalysisError(error, user, currentChatId, setChatHistory, setIsLoadingDocs, setIsLoadingAnalysis, messagesForFirestore, userId);
      }
      setIsLoadingDocs(false);
    } else {
      // Stream the response
      console.log('CHAT_HANDLER_DEBUG: Starting to stream response');
      let accumulatedText = '';
      
      await streamChat(
        userMessage,
        user?.uid || userId,
        currentChatId,
        (chunk) => {
          console.log('CHAT_HANDLER_DEBUG: Received chunk:', chunk);
          accumulatedText += chunk;
          setChatHistory(prev => {
            const newHistory = [...prev];
            const assistantMessageIndex = newHistory.findIndex(msg => msg.id === assistantMessageId);
            if (assistantMessageIndex !== -1) {
              console.log('CHAT_HANDLER_DEBUG: Current message state:', newHistory[assistantMessageIndex]);
              newHistory[assistantMessageIndex] = {
                ...newHistory[assistantMessageIndex],
                text: accumulatedText
              };
              console.log('CHAT_HANDLER_DEBUG: Updated message state:', newHistory[assistantMessageIndex]);
            } else {
              console.log('CHAT_HANDLER_DEBUG: Could not find message with id:', assistantMessageId);
            }
            return newHistory;
          });
        },
        selectedSpecialtyId
      );
      console.log('CHAT_HANDLER_DEBUG: Finished streaming response');

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
    }
  } catch (error) {
    console.error('Error handling message:', error);
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

const handleAnalysisData = async (data, user, currentChatId, setChatHistory, setActiveChat, setIsLoadingAnalysis, userId) => {
  const timestamp = new Date();
  const messageId = createMessageId('analysis');
  
  const analysisMessage = {
    id: messageId,
    isUser: false,
    analysis: data.data.analysis,
    timestamp
  };

  const firestoreMessage = {
    content: data.data.analysis,
    role: 'assistant',
    timestamp,
    type: 'analysis',
    messageId
  };
  
  const latestMessages = await getLatestMessages(user?.uid || userId, currentChatId);
  latestMessages.push(firestoreMessage);
  await addMessageToChat(user?.uid || userId, currentChatId, latestMessages);
  
  setActiveChat(current => ({
    ...current,
    messages: latestMessages
  }));

  setChatHistory(prev => {
    const updated = [...prev, analysisMessage];
    setIsLoadingAnalysis(false);
    return updated;
  });
};

const handlePmcidsData = async (data, user, currentChatId, setChatHistory, setActiveChat, setIsLoadingAnalysis, userId) => {
  setIsLoadingAnalysis(true);
  const timestamp = new Date();
  const messageId = createMessageId('document');
  
  const docsMessage = {
    id: messageId,
    type: 'document',
    isUser: false,
    currentProgress: "I've found relevant articles and am analyzing them...",
    articles: [],
    timestamp
  };

  const firestoreMessage = {
    content: JSON.stringify(docsMessage),
    role: 'assistant',
    timestamp,
    type: 'document',
    messageId
  };
  
  const latestMessages = await getLatestMessages(user?.uid || userId, currentChatId);
  latestMessages.push(firestoreMessage);
  await addMessageToChat(user?.uid || userId, currentChatId, latestMessages);
  
  setActiveChat(current => ({
    ...current,
    messages: latestMessages
  }));

  setChatHistory(prev => {
    const updated = [...prev, docsMessage];
    return updated;
  });
};

const handleAnalysisError = async (error, user, currentChatId, setChatHistory, setIsLoadingDocs, setIsLoadingAnalysis, messagesForFirestore, userId) => {
  console.error('Error processing request:', error);
  const errorMessage = {
    id: createMessageId('error'),
    text: "I'm sorry, there was an error processing your request. Please try again.",
    isUser: false,
    timestamp: new Date(),
    error: error.message
  };
  
  messagesForFirestore.push({
    content: errorMessage.text,
    role: 'assistant',
    timestamp: new Date(),
    type: 'error',
    messageId: errorMessage.id
  });
  
  setIsLoadingDocs(false);
  setIsLoadingAnalysis(false);
  setChatHistory(prev => [...prev, errorMessage]);
  
  await addMessageToChat(user?.uid || userId, currentChatId, messagesForFirestore);
};
