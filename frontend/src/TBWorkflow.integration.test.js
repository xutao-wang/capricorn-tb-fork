import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicalAssistantUI from './MedicalAssistantUI';
import * as api from './utils/api';
import { addMessageToChat, createNewChat, getSpecialtyById, getUserWeightPresets } from './firebase';
import { onSnapshot } from 'firebase/firestore';

jest.mock('./hooks/useAuth', () => {
  const user = { uid: 'synthetic-owner', isAnonymous: false };
  return { useAuth: () => ({ user, loading: false, isAuthenticated: true }) };
});
jest.mock('./firebase', () => ({
  auth: { currentUser: { uid: 'synthetic-owner', isAnonymous: false } },
  db: {},
  createNewChat: jest.fn(),
  addMessageToChat: jest.fn(),
  getSpecialtyById: jest.fn(),
  getUserWeightPresets: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('./utils/api', () => ({
  analyzeMedicalImage: jest.fn(),
  redactSensitiveInfo: jest.fn(),
  detectSpecialty: jest.fn(),
  extractDisease: jest.fn(),
  extractEvents: jest.fn(),
  retrieveAndAnalyzeArticles: jest.fn(),
}));
// Decorative/navigation/rendering boundaries are unrelated to the workflow.
// MainPanel, CaseInputSection, RadiologyFindingsCard, useChat/chatState,
// ChatContainer, and EvidenceWeightsReview all remain real.
jest.mock('./components/ExpandableSidebar', () => ({ WrappedExpandableSidebar: () => null }));
jest.mock('./components/TopBar', () => () => null);
jest.mock('./components/Feedback/FeedbackButton', () => () => null);
jest.mock('./components/Feedback/FeedbackModal', () => () => null);
jest.mock('./components/IntendedUseModal', () => () => null);
jest.mock('./components/ChatMessage', () => {
  const React = require('react');
  return React.forwardRef(() => null);
});
jest.mock('./components/MarkdownRenderer', () => () => null);
jest.mock('react-markdown', () => () => null);

const imageDraft = {
  parsedFindings: {
    modality: 'CXR',
    technicalQuality: 'adequate',
    findings: [
      { name: 'cavitation', status: 'present', location: 'right upper lung', description: 'Synthetic candidate phenotype' },
      { name: 'consolidation', status: 'indeterminate', location: null, description: 'Not established from this synthetic fixture' },
      { name: 'bilateral_extent', status: 'absent', location: null, description: 'Not observed in this synthetic fixture' },
      { name: 'miliary_pattern', status: 'not_assessable', location: null, description: 'Not assessable in this synthetic fixture' },
    ],
    summaryText: 'Draft research observations',
  },
  summaryText: 'Draft research observations',
  actionableEvents: ['cavitation'],
  metadata: { Format: 'PNG', OriginalDimensions: '256x256', PreviewDimensions: '256x256' },
  previewImage: 'data:image/jpeg;base64,c3ludGhldGljLXByZXZpZXc=',
  reviewRequired: true,
  model: 'gemini-3.8-flash',
};
const specialty = {
  id: 'tuberculosis',
  label: 'Synthetic research specialty',
  articleScoring: {
    fields: [{ key: 'clinicalRelevance', label: 'Clinical relevance', points: 10 }],
    perMatchedEventPoints: 1,
    journalImpactMultiplier: 1,
    yearDecayRate: 1,
    clinicalTrialBonus: 1,
    reviewPenalty: 1,
    citationImpactMultiplier: 1,
  },
};

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('Unexpected network request')));
  onSnapshot.mockReturnValue(() => {});
  createNewChat.mockResolvedValue('synthetic-chat');
  getSpecialtyById.mockResolvedValue(specialty);
  getUserWeightPresets.mockResolvedValue([]);
  api.redactSensitiveInfo.mockImplementation(async text => text.replace('synthetic private identifier', '[REDACTED]'));
  api.detectSpecialty.mockResolvedValue({ isClinicalCase: true, specialtyId: 'tuberculosis', label: specialty.label });
  api.extractDisease.mockResolvedValue({ disease: 'Tuberculosis' });
  api.extractEvents.mockResolvedValue({ events: ['cavitation', 'BRAF p.V600E'] });
});

test('reviewed four-finding image and confirmed weights permit exactly one retrieval without persisting pixels', async () => {
  let finishImage;
  let finishRetrieval;
  api.analyzeMedicalImage.mockReturnValue(new Promise(resolve => { finishImage = resolve; }));
  api.retrieveAndAnalyzeArticles.mockReturnValue(new Promise(resolve => { finishRetrieval = resolve; }));

  render(<MedicalAssistantUI />);
  fireEvent.change(screen.getByLabelText('Case notes'), {
    target: { value: 'Synthetic clinical case with synthetic private identifier and BRAF p.V600E' },
  });
  fireEvent.click(screen.getByRole('button', { name: /upload.*cxr/i }));
  fireEvent.change(screen.getByLabelText(/select imaging file/i), {
    target: { files: [new File(['synthetic-image-bytes'], 'synthetic.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(api.analyzeMedicalImage).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Submit case' })).toBeDisabled();
  expect(api.redactSensitiveInfo).not.toHaveBeenCalled();
  expect(api.detectSpecialty).not.toHaveBeenCalled();
  expect(api.extractEvents).not.toHaveBeenCalled();
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  expect(createNewChat).not.toHaveBeenCalled();

  await act(async () => finishImage(imageDraft));
  await screen.findByRole('heading', { name: /draft imaging observations/i });
  expect(screen.getByText(/consolidation: indeterminate/)).toBeInTheDocument();
  expect(screen.getByText(/miliary pattern: not_assessable/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Reviewed positive phenotypes'), {
    target: { value: 'cavitation in clinician-reviewed right upper lung' },
  });
  expect(screen.getByRole('button', { name: 'Submit case' })).toBeDisabled();
  expect(api.redactSensitiveInfo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /confirm reviewed findings/i }));
  expect(api.extractEvents).not.toHaveBeenCalled();
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit case' }));

  const continueButton = await screen.findByRole('button', { name: 'Continue to fetch papers' });
  expect(api.redactSensitiveInfo).toHaveBeenCalledTimes(1);
  expect(api.detectSpecialty).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
  expect(api.extractEvents).toHaveBeenCalledWith(
    expect.stringContaining('cavitation in clinician-reviewed right upper lung'), 'tuberculosis',
  );
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  expect(createNewChat).toHaveBeenCalledTimes(1);
  const [owner, messages] = createNewChat.mock.calls[0];
  expect(owner).toBe('synthetic-owner');
  const persistedCase = JSON.parse(messages[0].content);
  expect(persistedCase.caseNotes).toContain('[REDACTED]');
  expect(persistedCase.caseNotes).toContain('cavitation in clinician-reviewed right upper lung');
  expect(persistedCase.extractedEvents).toEqual(['cavitation', 'BRAF p.V600E']);

  fireEvent.click(continueButton);
  await waitFor(() => expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1));
  expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledWith(
    'Tuberculosis', ['cavitation', 'BRAF p.V600E'], 'tuberculosis', expect.any(Function), 1,
    expect.objectContaining({ clinicalRelevance: 10 }),
  );
  await act(async () => finishRetrieval());
  expect(api.retrieveAndAnalyzeArticles).toHaveBeenCalledTimes(1);

  const persistedPayload = JSON.stringify([...createNewChat.mock.calls, ...addMessageToChat.mock.calls]);
  expect(persistedPayload).not.toContain('synthetic private identifier');
  expect(persistedPayload).not.toContain('data:image');
  expect(persistedPayload).not.toContain(imageDraft.previewImage.split(',')[1]);
  expect(persistedPayload).not.toContain(btoa('synthetic-image-bytes'));
  expect(persistedPayload).not.toContain('previewImage');
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['classification', 'typed events'])('reviewed image cannot turn nonclinical %s into a persisted case or weights', async failureStage => {
  api.analyzeMedicalImage.mockResolvedValue(imageDraft);
  if (failureStage === 'classification') {
    api.detectSpecialty.mockResolvedValue({ isClinicalCase: false, specialtyId: 'tuberculosis' });
  } else {
    api.extractEvents.mockResolvedValue({ isClinicalCase: false, events: ['cavitation'] });
  }

  render(<MedicalAssistantUI />);
  fireEvent.change(screen.getByLabelText('Case notes'), { target: { value: 'Synthetic clinical fixture' } });
  fireEvent.click(screen.getByRole('button', { name: /upload.*cxr/i }));
  fireEvent.change(screen.getByLabelText(/select imaging file/i), {
    target: { files: [new File(['synthetic-image-bytes'], 'synthetic.png', { type: 'image/png' })] },
  });
  await screen.findByRole('heading', { name: /draft imaging observations/i });
  fireEvent.click(screen.getByRole('button', { name: /confirm reviewed findings/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit case' }));
  await screen.findByRole('alert');

  expect(createNewChat).not.toHaveBeenCalled();
  expect(addMessageToChat).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Continue to fetch papers' })).not.toBeInTheDocument();
  expect(api.retrieveAndAnalyzeArticles).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
