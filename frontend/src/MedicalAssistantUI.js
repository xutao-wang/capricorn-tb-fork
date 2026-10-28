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
import { redactSensitiveInfo, generateSampleCase, extractDisease, extractEvents, retrieveAndAnalyzeArticles, generateFinalAnalysis, sendFeedback, detectSpecialty } from './utils/api';
import { prepareClinicalCase, isValidExtraction } from './utils/caseValidation';
import { DEFAULT_ARTICLES } from './utils/config';
import { REQUEST_ERROR_EVENT } from './utils/request';
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
  const [submissionError,setSubmissionError] = useState('');
  const [localIntroduction,setLocalIntroduction] = useState('');
  useEffect(()=>{const handler=event=>setSubmissionError(event.detail);window.addEventListener(REQUEST_ERROR_EVENT,handler);return ()=>window.removeEventListener(REQUEST_ERROR_EVENT,handler);},[]);
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
  const [numArticles, setNumArticles] = useState(DEFAULT_ARTICLES);
  const [caseNotes, setCaseNotes] = useState('');
  const [labResults, setLabResults] = useState('');
  const [isNewChat, setIsNewChat] = useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [justExtracted, setJustExtracted] = useState(false);
  const [isLoadingFromHistory, setIsLoadingFromHistory] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const retrievalAttemptedRef = useRef(false);
  const retrievalBusyRef = useRef(null);
  const retrievalCompletedRef = useRef(false);
  const finalBusyRef = useRef(null);
  const caseVersionRef = useRef(0);
  const [shouldRetrieve, setShouldRetrieve] = useState(false);

const handleSidebarToggle = () => {
  setIsSidebarExpanded(prevState => !prevState);
};



  const { user, firstName, loading, handleLogin, handleLogout, isAuthenticated } = useAuth(setShowUserMenu);


  useEffect(() => {

  }, [isAuthenticated, firstName, showUserMenu]);

  const handleToggleUserMenu = () => {

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
    caseVersionRef.current += 1;
    retrievalCompletedRef.current = false;
    setIsRetrieving(false);
    setIsProcessingArticles(false);
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

const handleExtract = async (submittedNotes = caseNotes, submittedLabs = labResults, reviewedImageProvenance) => {
  if(isProcessing)return;
  caseVersionRef.current += 1;
  retrievalCompletedRef.current = false;
  setSubmissionError('');setLocalIntroduction('');
  setExtractedDisease('');setExtractedEvents([]);setDetectedSpecialty(null);
  setDetectedSpecialtyConfig(null);setWeightsConfirmed(false);setWeightOverrides(null);
  setShouldRetrieve(false);setJustExtracted(false);retrievalAttemptedRef.current=false;
  setIsProcessing(true);
  try {
    const result=await prepareClinicalCase(submittedNotes,submittedLabs,{redactSensitiveInfo,detectSpecialty,extractDisease,extractEvents});
    if(result.kind==='introduction'){setLocalIntroduction(result.message);return;}
    const config=await getSpecialtyById(result.detected.specialtyId);
    if(!config)throw Error('Evidence weights are unavailable for this specialty. Please try again.');
    if (reviewedImageProvenance) await initializeActiveChat(result.caseNotes,result.labResults,result.disease,result.events,reviewedImageProvenance);
    else await initializeActiveChat(result.caseNotes,result.labResults,result.disease,result.events);
    setCaseNotes(result.caseNotes);setLabResults(result.labResults);
    setDetectedSpecialty(result.detected);setDetectedSpecialtyConfig(config);
    setExtractedDisease(result.disease);setExtractedEvents(result.events);
    setJustExtracted(true);setShouldRetrieve(true);
  } catch {
    setSubmissionError('Case extraction could not be completed. Check that the input contains a clinical case and actionable findings, then try again. Redaction or service failures stop submission.');
  } finally {setIsProcessing(false);}
};

  const handleExampleLoad = (exampleCaseNotes, exampleLabResults) => {
    setCaseNotes(exampleCaseNotes);
    setLabResults(exampleLabResults);
  };

  const handleClearAll = useCallback(() => {
    caseVersionRef.current += 1;
    retrievalCompletedRef.current = false;
    retrievalAttemptedRef.current = false;
    setShouldRetrieve(false);
    setJustExtracted(false);
    setIsRetrieving(false);
    setIsProcessingArticles(false);
    setSubmissionError('');setLocalIntroduction('');


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


    // Force a re-render to ensure the UI updates
    setTimeout(() => {

    }, 0);
  }, [setCaseNotes, setLabResults, setExtractedDisease, setExtractedEvents, setDetectedSpecialty, setDetectedSpecialtyConfig, setWeightOverrides, setWeightsConfirmed, initializeNewChat, caseNotes, labResults]);

  const handleConfirmWeights = useCallback((weights) => {

    setWeightOverrides(weights);
    setWeightsConfirmed(true);
  }, []);

  const runFinalAnalysis = async (completedArticles, specialtyId, version = caseVersionRef.current) => {
    if (finalBusyRef.current === version || version !== caseVersionRef.current) return;
    finalBusyRef.current = version;
    try {
      await handleSendMessage({type: 'analysis', content: {isLoading: true}});
      const combinedNotes = ['Case Notes:', caseNotes, '\nLab Results:', labResults].join('\n\n');
      const finalAnalysis = await generateFinalAnalysis(combinedNotes, extractedDisease, extractedEvents, completedArticles, specialtyId);
      if (version !== caseVersionRef.current) return;
      if (typeof finalAnalysis?.markdown_content !== 'string' || !finalAnalysis.markdown_content.trim()) throw new Error('Invalid analysis');
      await handleSendMessage({type: 'analysis', content: finalAnalysis.markdown_content});
      if (version === caseVersionRef.current) setCurrentProgress('Processing complete.');
    } catch {
      if (version === caseVersionRef.current) {
        setCurrentProgress('Final analysis could not be completed. Please try again.');
        await handleSendMessage({type: 'analysis', content: {error: true}});
      }
    } finally { if (finalBusyRef.current === version) finalBusyRef.current = null; }
  };

  const handleRetryFinalAnalysis = () => {
    const document = chatHistory.find(msg => msg.type === 'document');
    if (!document || retrievalBusyRef.current === caseVersionRef.current || finalBusyRef.current === caseVersionRef.current || !chatHistory.some(msg => msg.error === 'final_analysis')) return;
    // One deliberate synthesis request, using the retained evidence; no search.
    runFinalAnalysis(document.articles, document.specialtyId || detectedSpecialty?.specialtyId).catch(() => {});
  };

  const handleRetrieve = async () => {


    // Check if retrieval should actually occur
    if (retrievalBusyRef.current === caseVersionRef.current || finalBusyRef.current === caseVersionRef.current || retrievalCompletedRef.current || hasDocumentMessages || isProcessingArticles || !weightsConfirmed || !isValidExtraction(extractedDisease,extractedEvents,detectedSpecialty)) {

      return;
    }

    const version = caseVersionRef.current;
    retrievalBusyRef.current = version;
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
      await retrieveAndAnalyzeArticles(
        extractedDisease,
        extractedEvents,
        detectedSpecialty?.specialtyId,
        async (data) => {
          if (version !== caseVersionRef.current) return;
          if (data.type === 'metadata') {
            if (data.data.status === 'processing') {
              setTotalArticles(data.data.total_articles);
              if (data.data.current_article > 0) {
                setCurrentProgress(`Analyzing candidate ${data.data.current_article} of ${data.data.total_articles}...`);
              } else {
                setCurrentProgress(`Analyzing ${data.data.total_articles} candidate articles...`);
              }
            } else if (data.data.status === 'complete') {
              await handleSendMessage({type: 'document', content: {
                articles: processedArticles, currentProgress: 'Article analysis complete.',
                specialtyId: detectedSpecialty?.specialtyId
              }});
              if (version !== caseVersionRef.current) return;
              retrievalCompletedRef.current = true;
              await runFinalAnalysis(processedArticles, detectedSpecialty?.specialtyId, version);
            }
          }
          else if (data.type === 'pmcids') {
            setPmcids(data.data.pmcids);
            setCurrentProgress('Retrieved top candidate articles, formatting results...');
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
              cancer: analysis.type_of_cancer || analysis.condition || 'Tuberculosis',
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


            const articleNumber = data.data.progress?.article_number || 0;
            const totalArticles = data.data.progress?.total_articles || 0;


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

      if (version === caseVersionRef.current) setCurrentProgress('Error retrieving articles. Please try again.');
    } finally {
      if (retrievalBusyRef.current === version) retrievalBusyRef.current = null;
      if (version === caseVersionRef.current) {
        setIsRetrieving(false);
        setIsProcessingArticles(false);
        setCurrentArticleData(null);
      }
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

    retrievalAttemptedRef.current = true;
    handleRetrieve();
    setJustExtracted(false);
    setShouldRetrieve(false);
  } else if (justExtracted) {

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

      {submissionError && <p role="alert" className="fixed top-16 left-1/4 right-4 z-40 bg-red-50 p-3">{submissionError}</p>}
      {localIntroduction && <p role="status" className="fixed top-20 left-1/4 right-4 z-30 bg-blue-50 p-3">{localIntroduction}</p>}
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
          initializeNewChat={handleClearAll}
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
          hasDocumentMessages={hasDocumentMessages}
          handleRetryFinalAnalysis={handleRetryFinalAnalysis}
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
