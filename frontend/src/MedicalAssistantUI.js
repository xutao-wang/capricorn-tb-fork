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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// Components
import IntendedUseModal from './components/IntendedUseModal';
import { WrappedExpandableSidebar } from './components/ExpandableSidebar';
import TopBar from './components/TopBar';
import MainPanel from './components/MainPanel/MainPanel';
import Footer from './components/Footer';
import LoadingSpinner from './components/LoadingSpinner';
import FeedbackButton from './components/Feedback/FeedbackButton';
import FeedbackModal from './components/Feedback/FeedbackModal';
import EvidenceWeightsReview from './components/EvidenceWeightsReview';

// Hooks
import { useAuth } from './hooks/useAuth';
import useChat from './hooks/useChat';

// API
import { generateSampleCase, extractDisease, extractEvents, retrieveAndAnalyzeArticles, generateFinalAnalysis, sendFeedback, detectSpecialty } from './utils/api';
import { getSpecialtyById } from './firebase';

// Preset Data
import { presetCaseNotes, presetLabResults } from './data/presetData';

// Utilities
const createMessageId = (type) => `${Date.now()}-${type}-${Math.random().toString(36).substr(2, 9)}`;

const MedicalAssistantUI = () => {
  const [showIntendedUse, setShowIntendedUse] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedDisease, setExtractedDisease] = useState('');
  const [extractedEvents, setExtractedEvents] = useState([]);
  const [isBox2Hovered, setIsBox2Hovered] = useState(false);
  const [isBox3Hovered, setIsBox3Hovered] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [isProcessingArticles, setIsProcessingArticles] = useState(false);
  const [articles, setArticles] = useState([]);
  const [currentProgress, setCurrentProgress] = useState('');
  const [pmcids, setPmcids] = useState([]);
  const [totalArticles, setTotalArticles] = useState(0);
  const [currentArticleData, setCurrentArticleData] = useState(null);
  const [isPromptExpanded, setIsPromptExpanded] = useState(true);
  const [numArticles, setNumArticles] = useState(15);
  const [caseNotes, setCaseNotes] = useState('');
  const [labResults, setLabResults] = useState('');
  const [isNewChat, setIsNewChat] = useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [justExtracted, setJustExtracted] = useState(false);
  const [isLoadingFromHistory, setIsLoadingFromHistory] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const retrievalAttemptedRef = useRef(false);
  const [shouldRetrieve, setShouldRetrieve] = useState(false);

const handleSidebarToggle = () => {
  setIsSidebarExpanded(prevState => !prevState);
};

  console.log('MedicalAssistantUI: setCaseNotes is a function:', typeof setCaseNotes === 'function');

  const { user, firstName, loading, handleLogin, handleLogout, isAuthenticated } = useAuth();
  console.log('[AUTH_MENU_DEBUG] MedicalAssistantUI: auth state:', { user, isAuthenticated, firstName, showUserMenu });

  useEffect(() => {
    console.log('[AUTH_MENU_DEBUG] MedicalAssistantUI: Authentication state changed:', { isAuthenticated, firstName, showUserMenu });
  }, [isAuthenticated, firstName, showUserMenu]);

  const handleToggleUserMenu = () => {
    console.log('[AUTH_MENU_DEBUG] MedicalAssistantUI: Toggling user menu');
    setShowUserMenu(prevState => !prevState);
  };
  
  // Auto-detected specialty persona for the current case -- see
  // docs/auto-specialty-detection-plan.md at the repo root. Set once per
  // case by handleExtract, before extractDisease/extractEvents run (those
  // two calls need to know the specialty already, since their prompts are
  // specialty-driven).
  const [detectedSpecialty, setDetectedSpecialty] = useState(null);

  // Full specialty config (persona + articleScoring rubric) for the
  // detected specialty, and the doctor's per-case scoring-weight
  // overrides -- see docs/evidence-weighting-plan-v1.md at the repo root.
  // Retrieval is gated on weightsConfirmed so the doctor sees the weights
  // panel before papers are fetched.
  const [detectedSpecialtyConfig, setDetectedSpecialtyConfig] = useState(null);
  const [weightOverrides, setWeightOverrides] = useState(null);
  const [weightsConfirmed, setWeightsConfirmed] = useState(false);

  const {
    chatHistory,
    isLoadingDocs,
    isLoadingAnalysis,
    activeChat,
    message,
    setMessage,
    handleChatSelect: originalHandleChatSelect,
    handleSendMessage,
    initializeNewChat,
    initializeActiveChat
  } = useChat(user, detectedSpecialty?.specialtyId);

  const hasDocumentMessages = useMemo(() => 
    chatHistory.some(msg => msg.type === 'document' || msg.documents),
    [chatHistory]
  );

  const handleChatSelect = (chat) => {
    setIsNewChat(true);
    setCaseNotes('');
    setLabResults('');
    setIsLoadingFromHistory(true);
    // Reset everything tied to whichever case was previously active --
    // without this, starting a new chat (or picking a different one from
    // history) left weightsConfirmed/weightOverrides/detectedSpecialty
    // stuck from the last case, which silently skipped the evidence-weights
    // picker for the new case and reused the old case's weights.
    setExtractedDisease('');
    setExtractedEvents([]);
    setDetectedSpecialty(null);
    setDetectedSpecialtyConfig(null);
    setWeightOverrides(null);
    setWeightsConfirmed(false);
    setArticles([]);
    setCurrentProgress('');
    setPmcids([]);
    setTotalArticles(0);
    setCurrentArticleData(null);
    setJustExtracted(false);
    setShouldRetrieve(false);
    retrievalAttemptedRef.current = false;
    originalHandleChatSelect(chat);
  };

  const handleGenerateSampleCase = async () => {
    setIsGeneratingSample(true);
    try {
      const sampleCase = await generateSampleCase();
      setMessage(sampleCase);
    } catch (error) {
      console.error('Error generating sample case:', error);
    }
    setIsGeneratingSample(false);
  };

  // No effect needed - modal shows on every visit
  const handleCloseIntendedUse = () => {
    setShowIntendedUse(false);
  };

  // Effect to handle loading case information when chat history changes
  useEffect(() => {
    if (chatHistory.length > 0) {
      // Find the initial case message
      const initialCaseMessage = chatHistory.find(msg => msg.initialCase);
      if (initialCaseMessage?.initialCase) {
        const { caseNotes: savedCaseNotes, labResults: savedLabResults, extractedDisease, extractedEvents } = initialCaseMessage.initialCase;
        setCaseNotes(savedCaseNotes);
        setLabResults(savedLabResults);
        setExtractedDisease(extractedDisease);
        setExtractedEvents(extractedEvents);
      }
    } else {
      // Clear all content and reset prompt expansion when there's no chat history
      setCaseNotes('');
      setLabResults('');
      setExtractedDisease('');
      setExtractedEvents([]);
      setIsPromptExpanded(true); // Reset prompt expansion when starting new chat
    }
    // Set isLoadingFromHistory back to false after loading is complete
    setIsLoadingFromHistory(false);
  }, [chatHistory]);

const handleExtract = async () => {
  console.log('[CHAT_DEBUG] Starting extraction process');
  try {
    setIsProcessing(true);
    console.log('[CHAT_DEBUG] User state:', {
      isAuthenticated: !!user,
      userId: user?.uid,
      isAnonymous: user?.isAnonymous
    });
    // Combine case notes and lab results with clear separation
    const combinedNotes = [
      "Case Notes:",
      caseNotes,
      "\nLab Results:",
      labResults
    ].join('\n\n');

    console.log('[CHAT_DEBUG] Detecting specialty from case notes');
    const detected = await detectSpecialty(combinedNotes);
    console.log('[CHAT_DEBUG] Detected specialty:', detected);
    setDetectedSpecialty(detected);

    // Fetch the full specialty config so the evidence-weights panel can
    // show sliders defaulting to this specialty's configured scoring
    // values. See docs/evidence-weighting-plan-v1.md at the repo root.
    try {
      const config = await getSpecialtyById(detected.specialtyId);
      setDetectedSpecialtyConfig(config);
    } catch (error) {
      console.error('[CHAT_DEBUG] Error fetching specialty config:', error);
    }

    console.log('[CHAT_DEBUG] Extracting disease and events from notes');
    const [disease, events] = await Promise.all([
      extractDisease(combinedNotes, detected.specialtyId),
      extractEvents(combinedNotes, detected.specialtyId)
    ]);
    console.log('[CHAT_DEBUG] Extraction results:', { disease, events });
    setExtractedDisease(disease);
    setExtractedEvents(events);
    setIsBox2Hovered(true); // Keep box 2 solid after extraction

    // Initialize active chat with the extracted information
    try {
      console.log('[CHAT_DEBUG] Initializing active chat with extracted data');
      await initializeActiveChat(caseNotes, labResults, disease, events);
      console.log('[CHAT_DEBUG] Chat initialization successful');
      
      // Reset the retrieval attempt ref, set justExtracted to true, and set shouldRetrieve to true
      retrievalAttemptedRef.current = false;
      setJustExtracted(true);
      setShouldRetrieve(true);
    } catch (error) {
      console.error('[CHAT_DEBUG] Error initializing chat:', error);
    }
  } catch (error) {
    console.error('[CHAT_DEBUG] Extraction error:', error);
    if (error.message.includes('Failed to fetch')) {
      setExtractedDisease('Network error. Please check your connection and try again.');
      setExtractedEvents(['Network error. Please check your connection and try again.']);
    } else {
      setExtractedDisease(error.message || 'Error extracting disease. Please try again.');
      setExtractedEvents([error.message || 'Error extracting events. Please try again.']);
    }
  } finally {
    setIsProcessing(false);
  }
};

  const handleExampleLoad = (exampleCaseNotes, exampleLabResults) => {
    setCaseNotes(exampleCaseNotes);
    setLabResults(exampleLabResults);
  };

  const handleClearAll = useCallback(() => {
    console.log('[CLEAR_DEBUG] MedicalAssistantUI: handleClearAll called');
    console.log('[CLEAR_DEBUG] Before clear - caseNotes:', caseNotes, 'labResults:', labResults);
    setCaseNotes('');
    setLabResults('');
    setExtractedDisease('');
    setExtractedEvents([]);
    setDetectedSpecialty(null);
    setDetectedSpecialtyConfig(null);
    setWeightOverrides(null);
    setWeightsConfirmed(false);
    setIsBox2Hovered(false);
    setIsBox3Hovered(false);
    setArticles([]);
    setCurrentProgress('');
    setPmcids([]);
    setTotalArticles(0);
    setCurrentArticleData(null);
    setIsPromptExpanded(true);
    setIsNewChat(true);
    initializeNewChat();
    console.log('[CLEAR_DEBUG] MedicalAssistantUI: All states reset');
    
    // Force a re-render to ensure the UI updates
    setTimeout(() => {
      console.log('[CLEAR_DEBUG] After timeout - caseNotes:', caseNotes, 'labResults:', labResults);
    }, 0);
  }, [setCaseNotes, setLabResults, setExtractedDisease, setExtractedEvents, setDetectedSpecialty, setDetectedSpecialtyConfig, setWeightOverrides, setWeightsConfirmed, initializeNewChat, caseNotes, labResults]);

  const handleConfirmWeights = useCallback((weights) => {
    console.log('[WEIGHTS_DEBUG] Doctor confirmed evidence weights:', weights);
    setWeightOverrides(weights);
    setWeightsConfirmed(true);
  }, []);

  const handleRetrieve = async () => {
    console.log('Retrieval triggered. Conditions:', {
      isProcessingArticles,
      extractedDisease,
      extractedEventsLength: extractedEvents.length,
      justExtracted,
      isRetrieving,
      hasDocumentMessages,
      isNewChat,
      hasCaseNotes: !!caseNotes,
      hasLabResults: !!labResults
    });

    // Check if retrieval should actually occur
    if (isProcessingArticles || !extractedDisease || !extractedEvents.length) {
      console.log('Retrieval aborted due to conditions not met');
      return;
    }

    setIsRetrieving(true);
    setIsProcessingArticles(true);
    setIsPromptExpanded(false);
    setArticles([]);
    setCurrentProgress('');
    setTotalArticles(0);
    setCurrentArticleData(null);

    // Create a local variable to store processed articles
    let processedArticles = [];

    try {
      // Combine case notes and lab results
      const combinedNotes = [
        "Case Notes:",
        caseNotes,
        "\nLab Results:",
        labResults
      ].join('\n\n');

      await retrieveAndAnalyzeArticles(
        extractedDisease,
        extractedEvents,
        detectedSpecialty?.specialtyId,
        async (data) => {
          if (data.type === 'metadata') {
            if (data.data.status === 'processing') {
              setTotalArticles(data.data.total_articles);
              setCurrentProgress(`Analyzing ${data.data.total_articles} articles...`);
            } else if (data.data.status === 'complete') {
              setCurrentProgress(`Article analysis complete. Generating final analysis...`);
              console.log('All articles processed. Total articles:', processedArticles.length);
              
              // First, send the document message
              console.log('[MEDICAL_UI] Creating document message with:', {
                processedArticlesCount: processedArticles.length,
                currentProgress: currentProgress,
                articlesData: processedArticles
              });
              
              const documentsContent = {
                type: 'document',
                content: {
                  articles: processedArticles,
                  currentProgress: currentProgress
                }
              };
              
              console.log('[MEDICAL_UI] Document message structure:', {
                type: documentsContent.type,
                hasContent: !!documentsContent.content,
                contentKeys: Object.keys(documentsContent.content),
                articlesInContent: documentsContent.content.articles?.length,
                fullContent: JSON.stringify(documentsContent, null, 2)
              });
              
              console.log('Sending document message to handleSendMessage:', JSON.stringify(documentsContent, null, 2));
              await handleSendMessage(documentsContent);
              console.log('Document message sent successfully');

              try {
                console.log('Starting final analysis with processed articles:', processedArticles.length);
                // Send the analysis loading state message
                const loadingContent = {
                  type: 'analysis',
                  content: {
                    isLoading: true
                  }
                };
                await handleSendMessage(loadingContent);

                const finalAnalysis = await generateFinalAnalysis(
                  combinedNotes,
                  extractedDisease,
                  extractedEvents,
                  processedArticles,
                  detectedSpecialty?.specialtyId
                );
              
                // Send the analysis as a separate message
                const analysisContent = {
                  type: 'analysis',
                  content: finalAnalysis.markdown_content
                };
                
                // Send the analysis message
                console.log('Sending analysis message to handleSendMessage:', JSON.stringify(analysisContent, null, 2));
                await handleSendMessage(analysisContent);
                console.log('Analysis message sent successfully');
                setCurrentProgress('Processing complete.');
              } catch (error) {
                console.error('Error generating final analysis:', error);
                setCurrentProgress('Error generating final analysis. Please try again.');
              }
            }
          }
          else if (data.type === 'pmcids') {
            setPmcids(data.data.pmcids);
            setCurrentProgress('Retrieved PMCIDs, creating links...');
          }
          else if (data.type === 'article_analysis') {
            const analysis = data.data.analysis.article_metadata;
            const articleData = {
              pmcid: analysis.PMCID,
              title: analysis.title,
              points: analysis.overall_points,
              content: data.data.analysis.full_article_text,
              journal_title: analysis.journal_title,
              journal_sjr: analysis.journal_sjr,
              year: analysis.year,
              cancer: analysis.type_of_cancer,
              type: analysis.paper_type,
              events: analysis.actionable_events,
              drugs_tested: analysis.drugs_tested,
              drug_results: analysis.drug_results,
              point_breakdown: analysis.point_breakdown
            };
            
            // Set current article being processed
            setCurrentArticleData(articleData);
            
            // Add to both state and local variable
            setArticles(current => [...current, articleData]);
            processedArticles.push(articleData);
            console.log('Added article to processed articles. Current count:', processedArticles.length);

            const articleNumber = data.data.progress?.article_number || 0;
            const totalArticles = data.data.progress?.total_articles || 0;
            console.log('Progress:', { articleNumber, totalArticles, processedArticlesLength: processedArticles.length });
            
            if (articleNumber > 0 && totalArticles > 0) {
              const progress = (articleNumber / totalArticles) * 100;
              setCurrentProgress(`Processed article ${articleNumber} out of ${totalArticles}`);
            }
          }
        },
        numArticles, // Pass numArticles to the API function
        weightOverrides
      );
    } catch (error) {
      console.error('[RETRIEVE_DEBUG] Error:', error);
      setCurrentProgress('Error retrieving articles. Please try again.');
    } finally {
      setIsRetrieving(false);
      setIsProcessingArticles(false);
      setCurrentArticleData(null);
    }
  };

useEffect(() => {
  if (justExtracted &&
      extractedDisease &&
      extractedEvents.length > 0 &&
      !isRetrieving &&
      !isProcessingArticles &&
      !hasDocumentMessages &&
      (caseNotes || labResults) &&
      !retrievalAttemptedRef.current &&
      shouldRetrieve &&
      weightsConfirmed) {
    console.log('[RETRIEVAL_DEBUG] Conditions met for retrieval');
    retrievalAttemptedRef.current = true;
    handleRetrieve();
    setJustExtracted(false);
    setShouldRetrieve(false);
  } else if (justExtracted) {
    console.log('[RETRIEVAL_DEBUG] Retrieval conditions not met:', {
      justExtracted,
      extractedDisease,
      extractedEventsLength: extractedEvents.length,
      isRetrieving,
      isProcessingArticles,
      hasDocumentMessages,
      hasCaseNotesOrLabResults: !!(caseNotes || labResults),
      retrievalAttempted: retrievalAttemptedRef.current,
      shouldRetrieve,
      weightsConfirmed
    });
  }
}, [justExtracted, extractedDisease, extractedEvents, isRetrieving, isProcessingArticles, hasDocumentMessages, isNewChat, caseNotes, labResults, shouldRetrieve, weightsConfirmed]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <LoadingSpinner />
      </div>
    );
  }

  const handleOpenFeedbackModal = () => {
    setShowFeedbackModal(true);
  };

  const handleCloseFeedbackModal = () => {
    setShowFeedbackModal(false);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar 
        user={user}
        firstName={firstName}
        handleLogin={handleLogin}
        handleLogout={handleLogout}
        showUserMenu={showUserMenu}
        setShowUserMenu={handleToggleUserMenu}
        isAuthenticated={isAuthenticated}
      />

      {/* Feedback Button and Modal */}
      <FeedbackButton onClick={handleOpenFeedbackModal} />
      <FeedbackModal isOpen={showFeedbackModal} onClose={handleCloseFeedbackModal} />
      <IntendedUseModal isOpen={showIntendedUse} onClose={handleCloseIntendedUse} />

      <div className="flex flex-1 min-h-0 relative w-full">
        <div className="absolute z-10">
        <WrappedExpandableSidebar
          user={user}
          onChatSelect={handleChatSelect}
          activeChat={activeChat}
          initializeNewChat={initializeNewChat}
          setIsNewChat={setIsNewChat}
          isExpanded={isSidebarExpanded}
          onToggle={handleSidebarToggle}
          setShouldRetrieve={setShouldRetrieve}
          setCaseNotes={setCaseNotes}
          setLabResults={setLabResults}
          setExtractedDisease={setExtractedDisease}
          setExtractedEvents={setExtractedEvents}
        />
        </div>

        <div className="ml-12 flex-1 flex w-full overflow-hidden">
          <MainPanel
          detectedSpecialty={detectedSpecialty}
          detectedSpecialtyConfig={detectedSpecialtyConfig}
          weightsConfirmed={weightsConfirmed}
          weightOverrides={weightOverrides}
          onConfirmWeights={handleConfirmWeights}
          extractedDisease={extractedDisease}
          extractedEvents={extractedEvents}
          setExtractedDisease={setExtractedDisease}
          setExtractedEvents={setExtractedEvents}
          articles={articles}
          setArticles={setArticles}
          currentArticleData={currentArticleData}
          chatHistory={chatHistory}
          isGeneratingSample={isGeneratingSample}
          isLoadingDocs={isLoadingDocs}
          isLoadingAnalysis={isLoadingAnalysis}
          message={message}
          setMessage={setMessage}
          handleSendMessage={handleSendMessage}
          handleGenerateSampleCase={handleGenerateSampleCase}
          caseNotes={caseNotes}
          setCaseNotes={setCaseNotes}
          labResults={labResults}
          setLabResults={setLabResults}
          isProcessing={isProcessing}
          handleExtract={handleExtract}
          currentProgress={currentProgress}
          numArticles={numArticles}
          setNumArticles={setNumArticles}
          isNewChat={isNewChat}
          firstName={firstName}
          isRetrieving={isRetrieving}
          handleRetrieve={handleRetrieve}
          isBox3Hovered={isBox3Hovered}
          setIsBox3Hovered={setIsBox3Hovered}
          isPromptExpanded={isPromptExpanded}
          setIsPromptExpanded={setIsPromptExpanded}
          handleClearAll={handleClearAll}
          justExtracted={justExtracted}
          setJustExtracted={setJustExtracted}
          isLoadingFromHistory={isLoadingFromHistory}
          isProcessingArticles={isProcessingArticles}
          setIsProcessingArticles={setIsProcessingArticles}
        />
        </div>
      </div>
      
      <Footer />
    </div>
  );
};

export default MedicalAssistantUI;
