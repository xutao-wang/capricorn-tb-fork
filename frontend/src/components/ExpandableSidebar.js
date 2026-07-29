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

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Plus, Pencil, Trash2, Stethoscope } from 'lucide-react';
import { getUserChats, deleteChat, updateChatTitle, createNewChat, getChatDocumentsRealTime } from '../firebase';
import SpecialistsPanel from './Specialists/SpecialistsPanel';

const formatChatTitle = (chat) => {
  if (chat.title) return chat.title;
  
  let timestamp;
  if (chat.createdAt?.seconds) {
    timestamp = new Date(chat.createdAt.seconds * 1000);
  } else if (chat.createdAt instanceof Date) {
    timestamp = chat.createdAt;
  } else {
    timestamp = new Date();
  }
  
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(timestamp);
};

const ChatHistoryItem = ({ chat, isActive, onClick, onRename, onDelete }) => {
  const [showOptions, setShowOptions] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(chat.title || '');

  const handleRename = async (e) => {
    e.preventDefault();
    if (newTitle.trim()) {
      await onRename(chat.id, newTitle.trim());
      setIsRenaming(false);
    }
  };

  if (isRenaming) {
    return (
      <form onSubmit={handleRename} className="p-1">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Enter chat title"
          className="w-full px-2 py-1 text-sm border rounded bg-white text-surface-900"
          autoFocus
          onBlur={() => setIsRenaming(false)}
        />
      </form>
    );
  }

  return (
    <div 
      className={`group flex items-center justify-between w-full text-left px-3 py-2 text-sm hover:bg-[#2c5282]/30 rounded-md ${
        isActive ? 'bg-[#2c5282]/30' : ''
      }`}
    >
      <button
        onClick={onClick}
        className="flex items-center flex-grow overflow-hidden text-white"
      >
        <MessageSquare size={16} className="mr-2 flex-shrink-0" />
        <span className="truncate">
          {formatChatTitle(chat)}
        </span>
      </button>
      
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
          className="p-1 hover:bg-[#2c5282]/50 rounded text-white"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(chat.id);
          }}
          className="p-1 hover:bg-[#2c5282]/50 rounded text-red-400"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

const ExpandableSidebar = ({ user, onChatSelect, activeChat, initializeNewChat, isExpanded, onToggle }) => {
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSpecialists, setShowSpecialists] = useState(false);

  useEffect(() => {
    let unsubscribe;

    const loadChats = async () => {
      if (user && isExpanded) {
        setIsLoading(true);
        setError(null);
        try {
          unsubscribe = getChatDocumentsRealTime(user.uid, (newChats) => {
            setChats(newChats);
            setIsLoading(false);
          });
        } catch (err) {
          console.error('Error loading chats:', err);
          setError('Failed to load chats. Please try again.');
          setIsLoading(false);
        }
      } else if (!isExpanded && unsubscribe) {
        unsubscribe();
      }
    };

    loadChats();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [user, isExpanded]);

  const handleRenameChat = async (chatId, newTitle) => {
    try {
      await updateChatTitle(user.uid, chatId, newTitle);
      setChats(chats.map(chat => 
        chat.id === chatId ? { ...chat, title: newTitle } : chat
      ));
    } catch (error) {
      console.error('Error renaming chat:', error);
    }
  };

  const handleDeleteChat = async (chatId) => {
    if (window.confirm('Are you sure you want to delete this chat?')) {
      try {
        await deleteChat(user.uid, chatId);
        setChats(chats.filter(chat => chat.id !== chatId));
        if (activeChat?.id === chatId) {
          onChatSelect(null);
        }
      } catch (error) {
        console.error('Error deleting chat:', error);
      }
    }
  };

const handleNewChat = async () => {
  if (user) {
    try {
      const chatId = await initializeNewChat();
      const newChat = {
        id: chatId,
        createdAt: {
          seconds: Math.floor(Date.now() / 1000),
          nanoseconds: 0
        },
        messages: []
      };
      setChats(prevChats => [newChat, ...prevChats]);
      onChatSelect(newChat);
      onToggle(false); // Minimize sidebar after creating new chat
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  }
};

  return (
    <div className={`fixed top-16 left-0 h-[calc(100vh-4rem)] bg-[#1a365d] shadow-lg transition-all duration-300 ease-in-out flex z-90 ${isExpanded ? 'w-64' : 'w-12'}`}>
      {/* Toggle button */}
      <button
        onClick={() => onToggle(!isExpanded)}
        className="absolute right-0 top-4 translate-x-full bg-[#1a365d] p-2 rounded-r-lg shadow-lg hover:bg-[#2c5282] transition-colors text-white"
        aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {isExpanded ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Sidebar content */}
      <div className={`w-full overflow-hidden transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
        <div className="p-4 text-white">
          <button
            onClick={() => setShowSpecialists(true)}
            className="flex items-center w-full text-left px-3 py-2 mb-3 text-sm text-white hover:bg-[#2c5282]/30 rounded-md"
          >
            <Stethoscope size={16} className="mr-2" />
            Specialists
          </button>

          <h2 className="text-xs font-semibold text-surface-200 uppercase tracking-wider mb-2">
            Chat History
          </h2>
          <div className="space-y-2">
            {user ? (
              <>
                <button
                  onClick={handleNewChat}
                  className="flex items-center w-full text-left px-3 py-2 text-sm text-white hover:bg-[#2c5282]/30 rounded-md"
                >
                  <Plus size={16} className="mr-2" />
                  Start New Chat
                </button>
                {isLoading ? (
                  <div className="text-sm text-surface-200 px-3 py-2">
                    Loading chats...
                  </div>
                ) : error ? (
                  <div className="text-sm text-red-400 px-3 py-2">
                    {error}
                  </div>
                ) : (
                  <div className="max-h-[calc(100vh-12rem)] overflow-y-auto space-y-1">
                    {chats.map((chat) => (
                      <ChatHistoryItem
                        key={chat.id}
                        chat={chat}
                        isActive={activeChat?.id === chat.id}
                        onClick={() => {
                          onChatSelect(chat);
                          onToggle(false);
                        }}
                        onRename={handleRenameChat}
                        onDelete={handleDeleteChat}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-surface-200 px-3 py-2">
                Sign in to view chat history
              </div>
            )}
          </div>
        </div>
      </div>

      <SpecialistsPanel isOpen={showSpecialists} onClose={() => setShowSpecialists(false)} user={user} />
    </div>
  );
};

// Wrap the ExpandableSidebar component to ensure onChatSelect is called correctly
const WrappedExpandableSidebar = ({
  onChatSelect,
  setIsNewChat,
  setShouldRetrieve,
  setCaseNotes,
  setLabResults,
  setExtractedDisease,
  setExtractedEvents,
  ...otherProps
}) => {
  const wrappedOnChatSelect = (chat) => {
    onChatSelect(chat);
    // This will trigger the fade-in effect in WelcomeText
    setIsNewChat(true);
    // Set shouldRetrieve to false when a chat is selected from history
    if (setShouldRetrieve) setShouldRetrieve(false);
    // Reset other states
    if (setCaseNotes) setCaseNotes('');
    if (setLabResults) setLabResults('');
    if (setExtractedDisease) setExtractedDisease('');
    if (setExtractedEvents) setExtractedEvents([]);
  };

  const wrappedHandleNewChat = async () => {
    if (otherProps.user) {
      try {
        const chatId = await otherProps.initializeNewChat();
        const newChat = {
          id: chatId,
          createdAt: {
            seconds: Math.floor(Date.now() / 1000),
            nanoseconds: 0
          },
          messages: []
        };
        wrappedOnChatSelect(newChat);
        otherProps.onToggle(false); // Minimize sidebar after creating new chat
      } catch (error) {
        console.error('Error creating new chat:', error);
      }
    }
  };

  return (
    <ExpandableSidebar
      {...otherProps}
      onChatSelect={wrappedOnChatSelect}
      initializeNewChat={wrappedHandleNewChat}
    />
  );
};

export { WrappedExpandableSidebar };
