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

// src/components/EvidenceWeightsReview.js
//
// Lets a doctor adjust the weight of every factor that currently
// influences article scoring, before retrieval runs. Sliders default to
// the detected specialty's configured values; adjustments are sent as a
// per-request override and never written back to the specialty's stored
// config. See docs/evidence-weighting-plan-v1.md at the repo root.
//
// Signed-in (non-anonymous) doctors can also save the current slider
// configuration as a named, reusable preset (e.g. "Genomics Heavy") and
// apply a saved preset as a starting point on a later case -- see
// docs/weight-presets-plan.md at the repo root. Presets are scoped per
// specialty since factor keys differ across specialties.

import React, { useEffect, useMemo, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { auth, getUserWeightPresets, saveUserWeightPreset, deleteUserWeightPreset } from '../firebase';

export const buildSliderDefs = (scoring) => [
  ...scoring.fields.map(f => ({
    key: f.key,
    label: f.label,
    description: f.description,
    max: Math.max(f.points * 2, 20)
  })),
  {
    key: 'perMatchedEventPoints',
    label: 'Matched Actionable Events (per match)',
    description: 'Points awarded for each of the patient\'s actionable events that this article also mentions',
    max: Math.max(scoring.perMatchedEventPoints * 2, 20)
  },
  {
    key: 'journalImpactMultiplier',
    label: 'Journal Impact Multiplier',
    description: 'How much a journal\'s impact score (SJR) contributes to the overall score',
    max: Math.max(scoring.journalImpactMultiplier * 2, 10)
  },
  {
    key: 'yearDecayRate',
    label: 'Recency Decay Rate (points per year old)',
    description: 'How much older articles are penalized relative to more recent ones',
    max: Math.max(scoring.yearDecayRate * 2, 10)
  },
  {
    key: 'clinicalTrialBonus',
    label: 'Clinical Trial Bonus',
    description: 'Extra points for articles that are clinical trials',
    max: Math.max(scoring.clinicalTrialBonus * 2, 50)
  },
  {
    key: 'reviewPenalty',
    label: 'Review Penalty',
    description: 'Points deducted for articles that are literature reviews rather than original research',
    max: Math.max(scoring.reviewPenalty * 2, 10)
  },
  {
    key: 'citationImpactMultiplier',
    label: 'Citation Impact Multiplier',
    description: 'How much an article\'s citation impact (Relative Citation Ratio, from NIH iCite) contributes to the overall score',
    max: Math.max(scoring.citationImpactMultiplier * 2, 10)
  }
];

const buildDefaultWeights = (scoring) => {
  const defaults = {};
  scoring.fields.forEach(f => { defaults[f.key] = f.points; });
  defaults.perMatchedEventPoints = scoring.perMatchedEventPoints;
  defaults.journalImpactMultiplier = scoring.journalImpactMultiplier;
  defaults.yearDecayRate = scoring.yearDecayRate;
  defaults.clinicalTrialBonus = scoring.clinicalTrialBonus;
  defaults.reviewPenalty = scoring.reviewPenalty;
  defaults.citationImpactMultiplier = scoring.citationImpactMultiplier;
  return defaults;
};

const EvidenceWeightsReview = ({ specialty, onContinue }) => {
  const scoring = specialty.articleScoring;
  const defaultWeights = useMemo(() => buildDefaultWeights(scoring), [scoring]);
  const sliderDefs = useMemo(() => buildSliderDefs(scoring), [scoring]);
  const [weights, setWeights] = useState(defaultWeights);

  const user = auth.currentUser;
  const canSavePresets = !!user && !user.isAnonymous;

  const [presets, setPresets] = useState([]);
  const [activePresetId, setActivePresetId] = useState(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState('');
  const [presetError, setPresetError] = useState(null);

  useEffect(() => {
    if (!canSavePresets) return;
    getUserWeightPresets(user.uid, specialty.id)
      .then(setPresets)
      .catch(() => setPresetError('Failed to load saved preferences.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty.id, canSavePresets]);

  const updateWeight = (key, value) => {
    setWeights(prev => ({ ...prev, [key]: Number(value) }));
    setActivePresetId(null);
  };

  const handleReset = () => {
    setWeights(defaultWeights);
    setActivePresetId(null);
  };

  const handleApplyPreset = (preset) => {
    // Merge over defaults rather than replacing outright -- a preset saved
    // before the persona was edited (see Specialists tab) may be missing
    // factors the persona currently defines, or carry factors it no longer
    // does. Missing keys fall back to the current specialty default;
    // extra keys are harmless (calculate_points ignores unknown overrides).
    setWeights({ ...defaultWeights, ...preset.weights });
    setActivePresetId(preset.id);
  };

  const handleSavePreset = async () => {
    if (!newPresetLabel.trim()) {
      setPresetError('Give this preference a name first.');
      return;
    }
    setPresetError(null);
    try {
      const id = await saveUserWeightPreset(user.uid, specialty.id, newPresetLabel.trim(), weights);
      setPresets(prev => [...prev, { id, label: newPresetLabel.trim(), specialtyId: specialty.id, weights }]);
      setActivePresetId(id);
      setNewPresetLabel('');
      setIsSavingPreset(false);
    } catch (e) {
      setPresetError('Failed to save this preference. Please try again.');
    }
  };

  const handleDeletePreset = async (presetId) => {
    try {
      await deleteUserWeightPreset(user.uid, presetId);
      setPresets(prev => prev.filter(p => p.id !== presetId));
      if (activePresetId === presetId) setActivePresetId(null);
    } catch (e) {
      setPresetError('Failed to delete this preference. Please try again.');
    }
  };

  const handleContinue = () => onContinue(weights);

  return (
    <div className="w-full md:w-1/2 bg-surface-50 shadow-lg rounded-lg p-4 mb-4">
      <div className="mb-2">
        <h2 className="text-xs font-medium text-gray-700">
          Adjust how much each factor matters for {specialty.label}
        </h2>
        <p className="text-[10px] text-gray-500 mt-1">
          These weights apply to this case only. Defaults come from the {specialty.label} specialty and are not changed for future cases.
        </p>
      </div>

      {canSavePresets && (
        <div className="mb-3 pb-3 border-b border-surface-200">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-gray-600 uppercase tracking-wide">Your saved preferences</span>
            <button
              onClick={() => setIsSavingPreset(v => !v)}
              className="flex items-center text-[10px] text-blue-600 hover:text-blue-800"
            >
              <Save size={11} className="mr-1" /> Save current as new preference
            </button>
          </div>

          {presetError && <p className="text-[10px] text-red-600 mb-1.5">{presetError}</p>}

          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border cursor-pointer ${
                    activePresetId === preset.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-surface-300 hover:border-blue-400'
                  }`}
                >
                  <span onClick={() => handleApplyPreset(preset)}>{preset.label}</span>
                  <Trash2
                    size={10}
                    className={activePresetId === preset.id ? 'text-white/70 hover:text-white' : 'text-gray-400 hover:text-red-500'}
                    onClick={(e) => { e.stopPropagation(); handleDeletePreset(preset.id); }}
                  />
                </div>
              ))}
            </div>
          )}

          {isSavingPreset && (
            <div className="flex gap-1.5 mt-1">
              <input
                type="text"
                value={newPresetLabel}
                onChange={(e) => setNewPresetLabel(e.target.value)}
                placeholder="e.g. Genomics Heavy"
                className="flex-1 text-[10px] border border-surface-300 rounded px-2 py-1"
                autoFocus
              />
              <button
                onClick={handleSavePreset}
                className="text-[10px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => { setIsSavingPreset(false); setNewPresetLabel(''); setPresetError(null); }}
                className="text-[10px] px-2 py-1 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col space-y-3 max-h-80 overflow-y-auto pr-1">
        {sliderDefs.map(def => (
          <div key={def.key} className="flex flex-col gap-0.5" title={def.description}>
            <div className="flex justify-between items-baseline">
              <label className="text-[10px] font-light text-gray-700">{def.label}</label>
              <span className="text-[10px] font-medium text-gray-600">{weights[def.key]}</span>
            </div>
            <input
              type="range"
              min={0}
              max={def.max}
              value={weights[def.key]}
              onChange={(e) => updateWeight(def.key, e.target.value)}
              className="w-full h-1.5 accent-blue-600"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-3">
        <button
          onClick={handleReset}
          className="text-[10px] text-gray-500 hover:text-gray-700"
        >
          Use defaults
        </button>
        <button
          onClick={handleContinue}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Continue to fetch papers
        </button>
      </div>
    </div>
  );
};

export default EvidenceWeightsReview;
