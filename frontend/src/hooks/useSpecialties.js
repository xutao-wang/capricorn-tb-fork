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

// src/hooks/useSpecialties.js
//
// Loads the available Specialty personas from Firestore (see
// docs/persona-system-plan.md at the repo root for the schema) and lets a
// doctor pick one, or create a new one from a simplified form. The form only
// collects label / persona title / board name / event categories -- the
// rest of the schema (few-shot examples, scoring rubric) is filled in with
// generic, domain-agnostic defaults, since asking a doctor to hand-author a
// JSON scoring rubric isn't realistic UX. Existing curated specialties
// always take priority; custom ones just add to the list.

import { useState, useEffect, useCallback } from 'react';
import { getSpecialties, createSpecialty } from '../firebase';

const DEFAULT_SPECIALTY_ID = 'pediatric-oncology';
const LAST_SELECTED_KEY = 'capricorn.selectedSpecialtyId';

const GENERIC_SCORING_FIELDS = [
  { key: 'disease_match', label: 'Disease Match', points: 50, description: "Set to true if the article's disease focus matches the patient's condition.", optional: false },
  { key: 'drugs_tested', label: 'Drugs Tested', points: 5, description: 'Whether any drugs or interventions are mentioned as tested', optional: false },
  { key: 'treatment_shown', label: 'Treatment Results', points: 50, description: 'Set to true if the article demonstrates positive treatment results', optional: false },
  { key: 'cell_studies', label: 'Cell Studies', points: 5, description: 'Whether interventions were tested on cells in vitro', optional: false },
  { key: 'mice_studies', label: 'Animal Model Studies', points: 10, description: 'Whether interventions were tested in animal models', optional: false },
  { key: 'case_report', label: 'Case Report', points: 5, description: 'Whether the article presents a case report', optional: false },
  { key: 'series_of_case_reports', label: 'Series of Case Reports', points: 10, description: 'Whether the article presents multiple case reports', optional: false },
  { key: 'clinical_study', label: 'Clinical Study', points: 15, description: 'Whether the article describes a clinical study', optional: false },
  { key: 'novelty', label: 'Novelty', points: 10, description: 'If the paper describes a novel mechanism or therapeutic strategy', optional: false },
];

const slugify = (label) =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// Builds a full Specialty document from the simplified form fields a doctor
// fills in. `categories` is an array of { name, examples } where `examples`
// is a free-text comma-separated string.
export const buildSpecialtyFromForm = ({ label, personaTitle, boardName, categories }) => {
  const id = slugify(label);
  const normalizedTitle = (personaTitle || label).toLowerCase();

  return {
    id,
    label,
    personaTitle: normalizedTitle,
    boardName: boardName ? boardName.trim() : null,
    diseaseExtraction: {
      guidance: null,
      fewShotExamples: []
    },
    eventExtraction: {
      categoryIntro: 'Extract all clinically relevant and actionable events in the following categories:',
      categories: categories.map((cat, i) => ({
        name: cat.name,
        block: `**Category ${i + 1} — ${cat.name}:**\n${cat.examples}`
      })),
      postCategoryNotes: [
        'Focus on information that is directly relevant to potential therapy selection or clinical management.'
      ],
      fewShotExample: null,
      guidanceNotes: []
    },
    articleScoring: {
      evaluationGoal: `evaluate full research articles related to ${label.toLowerCase()}, to identify potential advancements in treatment and understanding of the disease`,
      domainFilterField: {
        key: 'domain_focus',
        label: `${label} Focus`,
        description: `Whether the article relates to ${label.toLowerCase()}`
      },
      perMatchedEventPoints: 15,
      fields: GENERIC_SCORING_FIELDS
    },
    finalAnalysis: {
      personaRole: normalizedTitle
    },
    chatContextLabel: `${label.toLowerCase()} case`
  };
};

const useSpecialties = (isAuthReady) => {
  const [specialties, setSpecialties] = useState([]);
  const [selectedSpecialtyId, setSelectedSpecialtyIdState] = useState(
    () => localStorage.getItem(LAST_SELECTED_KEY) || DEFAULT_SPECIALTY_ID
  );
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await getSpecialties();
      list.sort((a, b) => a.label.localeCompare(b.label));
      setSpecialties(list);
    } catch (error) {

    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait for Firebase auth (including the app's automatic anonymous
    // sign-in) to resolve before querying Firestore -- otherwise this races
    // request.auth in firestore.rules and fails with a permissions error.
    if (isAuthReady) {
      refresh();
    }
  }, [isAuthReady, refresh]);

  const setSelectedSpecialtyId = useCallback((id) => {
    setSelectedSpecialtyIdState(id);
    localStorage.setItem(LAST_SELECTED_KEY, id);
  }, []);

  const addSpecialty = useCallback(async (formValues) => {
    const specialty = buildSpecialtyFromForm(formValues);
    await createSpecialty(specialty);
    await refresh();
    setSelectedSpecialtyId(specialty.id);
    return specialty;
  }, [refresh, setSelectedSpecialtyId]);

  return {
    specialties,
    isLoading,
    selectedSpecialtyId,
    setSelectedSpecialtyId,
    addSpecialty
  };
};

export default useSpecialties;
