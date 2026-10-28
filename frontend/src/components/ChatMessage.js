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

// src/components/ChatMessage.js

import React, { useState, forwardRef } from 'react';
import { AlertCircle } from 'lucide-react';
import ArticleResults from './MainPanel/ArticleResults';
import ReactMarkdown from 'react-markdown';

const fadeInClass = "transition-opacity duration-1000 ease-in-out";

const InitialCaseMessage = ({ message, show }) => {
  return (
    <div className={`w-full md:w-1/2 bg-surface-50 shadow-lg rounded-lg p-4 mb-4 ${fadeInClass} ${show ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex items-center">
        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <h2 className="text-xs font-medium text-gray-700 ml-2">Case initialized with disease: {message.initialCase.extractedDisease}</h2>
      </div>
    </div>
  );
};

const ChatMessage = React.forwardRef(({ message, showInitialCase }, ref) => {
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);



  // Add specific logging for initialization messages
  if (message.initialCase) {

  }

  const isError = message.text && message.text.includes("I'm sorry, there was an error");
  const isDocument = message.type === 'document';
  const isAnalysis = message.analysis !== undefined;
  const hideAssistantHeader = message.initialCase || isAnalysis;

  if (message.initialCase) {
    return <InitialCaseMessage message={message} show={showInitialCase} />;
  }

  return (
    <div ref={ref} className={`flex flex-col ${message.isUser ? 'items-end' : 'items-start'} mb-4`}>
      <div
        className={`${isDocument || isAnalysis ? 'w-full' : 'max-w-xs md:max-w-md lg:max-w-lg xl:max-w-xl'} rounded-lg p-3 ${
          isError
            ? 'bg-red-50 border border-red-200 text-red-800'
            : message.isUser
              ? 'bg-surface-700 text-white'
              : 'bg-surface-100 text-surface-800'
        }`}
      >
        <div className={`text-sm overflow-x-auto ${message.isUser ? 'text-white !important' : ''}`}>
          {(() => {
            if (isDocument) {


              return (
                <ArticleResults
                  currentProgress={message.currentProgress}
                  articles={message.articles}
                />
              );
            }
            if (message.text || message.analysis) {
              if (isError) {
                return (
                  <>
                    <div className="overflow-x-auto">
                      {message.text}
                    </div>
                    {!isErrorExpanded && (
                      <button
                        onClick={() => setIsErrorExpanded(true)}
                        className="ml-2 text-red-600 hover:text-red-800 underline text-sm"
                      >
                        Show Details
                      </button>
                    )}
                    {isErrorExpanded && (
                      <div className="mt-2 text-xs text-red-700 bg-red-100 p-2 rounded">
                        Error Details:
                        <pre className="mt-1 whitespace-pre-wrap">
                          {message.error || "No additional error details available"}
                        </pre>
                        <button
                          onClick={() => setIsErrorExpanded(false)}
                          className="mt-2 text-red-600 hover:text-red-800 underline"
                        >
                          Hide Details
                        </button>
                      </div>
                    )}
                  </>
                );
              }
              return (
                <>
                  <div className={`prose prose-sm max-w-none ${
                    message.isUser
                      ? 'prose-headings:text-white prose-p:text-white prose-li:text-white'
                      : 'prose-headings:text-gray-800 prose-p:text-gray-600 prose-li:text-gray-600'
                  } prose-headings:font-bold prose-h1:text-lg prose-h2:text-base prose-p:text-sm prose-li:text-sm prose-a:text-blue-600 hover:prose-a:text-blue-800 prose-headings:mb-2 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5`}>
                    <ReactMarkdown>{message.text || message.analysis}</ReactMarkdown>
                  </div>
                </>
              );
            }
            return null;
          })()}
        </div>
      </div>
      {!message.isUser && !message.initialCase && (
        <div className="text-[0.50rem] text-gray-400 italic ml-4 mt-1 mb-2">
          Message requires physician interpretation and clinical judgment.
        </div>
      )}
    </div>
  );
});

export default ChatMessage;
