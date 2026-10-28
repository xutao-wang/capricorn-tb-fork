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

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { findLastIndex } from 'lodash';
import ChatContainer from '../Chat/ChatContainer';
import CaseInputSection from './CaseInputSection';
import WelcomeText from './WelcomeText';
import { db, auth } from '../../firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';

const fadeAwayClass = "transition-opacity duration-500 ease-in-out";

const CHAT_INPUT_HEIGHT = 60; // Estimated height of ChatInput

const MainPanel = ({
  chatHistory,
  articles,
  currentArticleData,
  isGeneratingSample,
  isLoadingDocs,
  isLoadingAnalysis,
  handleGenerateSampleCase,
  caseNotes,
  setCaseNotes,
  labResults,
  setLabResults,
  isProcessing,
  handleExtract,
  currentProgress,
  numArticles,
  setNumArticles,
  isNewChat,
  firstName,
  extractedDisease,
  extractedEvents,
  setExtractedDisease,
  setExtractedEvents,
  detectedSpecialty,
  detectedSpecialtyConfig,
  weightsConfirmed,
  weightOverrides,
  onConfirmWeights,
  isRetrieving,
  handleRetrieve,
  isBox3Hovered,
  setIsBox3Hovered,
  message,
  setMessage,
  handleSendMessage,
  handleClearAll,
  justExtracted,
  setJustExtracted,
  isLoadingFromHistory,
  isProcessingArticles,
  setIsProcessingArticles
}) => {
  const [hasAnalysisMessage, setHasAnalysisMessage] = useState(false);
  const [shouldUseScrollEffect, setShouldUseScrollEffect] = useState(false);
  const [showInitialCase, setShowInitialCase] = useState(false);

  const handleExtractionComplete = useCallback(() => {
    setJustExtracted(true);
  }, [setJustExtracted]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const chatRef = collection(db, `chats/${user.uid}/conversations`);
    const q = query(chatRef);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const hasAnalysis = querySnapshot.docs.some(doc => {
        const messages = doc.data().messages || [];
        return messages.some(message => message.type === 'analysis');
      });
      setHasAnalysisMessage(hasAnalysis);
    });

    return () => unsubscribe();
  }, [auth.currentUser]);
  const [showWelcomeText, setShowWelcomeText] = useState(true);
  const [isBox2Hovered, setIsBox2Hovered] = useState(false);
  const [isExtractionSectionExpanded, setIsExtractionSectionExpanded] = useState(false);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [showCaseInput, setShowCaseInput] = useState(true);
  const finalAnalysisRef = useRef(null);
  const messageEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const findLastMessageIndex = useCallback((history) => {
    return findLastIndex(history, msg => msg.type === 'message');
  }, []);

  const handleExtractWithWelcomeText = useCallback((notes,labs) => {
    setShowWelcomeText(false);

    handleExtract(notes,labs);
  }, [handleExtract]);

  // Update state without scroll effects
  useEffect(() => {
    setShowWelcomeText(chatHistory.length === 0 && isNewChat);
    setShowCaseInput(isNewChat && chatHistory.length === 0);
  }, [chatHistory, isNewChat]);

  // Reset isPromptExpanded when a new extraction occurs
  useEffect(() => {
    if (extractedDisease || extractedEvents.length > 0) {
      setIsPromptExpanded(false);
    }
  }, [extractedDisease, extractedEvents]);

  // Reset case notes and lab results when a new chat is initiated
  useEffect(() => {
    if (isNewChat) {
      setCaseNotes('');
      setLabResults('');
      setShowCaseInput(true);
    }
  }, [isNewChat]);

  useEffect(() => {
    if (isNewChat) {
      setShouldUseScrollEffect(true);
    }
  }, [isNewChat]);

  useEffect(() => {
    if (chatHistory.length > 0 && chatHistory[0].initialCase) {
      setShowInitialCase(true);
    }
  }, [chatHistory]);

  if (showCaseInput) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden px-4">
        <div className="flex-shrink-0 text-center pt-40 sm:pt-40 lg:pt-56" style={{ maxHeight: '20vh' }}>
          <WelcomeText show={true} firstName={firstName} />
        </div>
        <div className="flex-grow w-full sm:max-w-2xl mx-auto mt-24 pb-32">
          <div className={`${fadeAwayClass} opacity-100`}>
            <CaseInputSection
              caseNotes={caseNotes}
              setCaseNotes={setCaseNotes}
              labResults={labResults}
              setLabResults={setLabResults}
              isProcessing={isProcessing}
              handleExtract={handleExtractWithWelcomeText}
              handleExampleLoad={(exampleCaseNotes, exampleLabResults) => {
                setCaseNotes(exampleCaseNotes);
                setLabResults(exampleLabResults);
              }}
              showCaseInput={showCaseInput}
              handleClearAll={() => {

                handleClearAll();
                setCaseNotes('');
                setLabResults('');

              }}
              numArticles={numArticles}
              setNumArticles={setNumArticles}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full relative w-full sm:max-w-4xl mx-auto overflow-hidden">
      <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-0">
        <WelcomeText show={showWelcomeText} firstName={firstName} />
      </div>
      <div ref={chatContainerRef} className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden mt-24">
          <ChatContainer
            chatInputHeight={CHAT_INPUT_HEIGHT}
            chatHistory={chatHistory}
            isGeneratingSample={isGeneratingSample}
            isLoadingDocs={isLoadingDocs}
            isLoadingAnalysis={isLoadingAnalysis}
            currentProgress={currentProgress}
            currentArticleData={currentArticleData}
            articles={articles}
            finalAnalysisRef={finalAnalysisRef}
            messageEndRef={messageEndRef}
            showArticleResults={true}
            initialArticleResultsExpanded={true}
            totalArticles={numArticles}
            processedArticles={articles.length}
            extractedDisease={extractedDisease}
            extractedEvents={extractedEvents}
            setExtractedDisease={setExtractedDisease}
            setExtractedEvents={setExtractedEvents}
            detectedSpecialty={detectedSpecialty}
            detectedSpecialtyConfig={detectedSpecialtyConfig}
            weightsConfirmed={weightsConfirmed}
            weightOverrides={weightOverrides}
            onConfirmWeights={onConfirmWeights}
            isRetrieving={isRetrieving}
            handleRetrieve={handleRetrieve}
            isBox3Hovered={isBox3Hovered}
            setIsBox3Hovered={setIsBox3Hovered}
            isPromptExpanded={isPromptExpanded}
            setIsPromptExpanded={setIsPromptExpanded}
            numArticles={numArticles}
            setNumArticles={setNumArticles}
            shouldUseScrollEffect={shouldUseScrollEffect}
            message={message}
            setMessage={setMessage}
            handleSendMessage={handleSendMessage}
            handleGenerateSampleCase={handleGenerateSampleCase}
            isLoading={isLoadingDocs || isLoadingAnalysis || isGeneratingSample}
            showInitialCase={showInitialCase}
            justExtracted={justExtracted}
            setJustExtracted={setJustExtracted}
            onExtractionComplete={handleExtractionComplete}
            isLoadingFromHistory={isLoadingFromHistory}
            isProcessingArticles={isProcessingArticles}
            setIsProcessingArticles={setIsProcessingArticles}
          />
      </div>
    </main>
  );
};

export default MainPanel;
