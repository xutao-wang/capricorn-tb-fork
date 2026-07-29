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

// src/components/WeightsSummaryBox.js
//
// Read-only summary of the scoring weights the doctor confirmed via
// EvidenceWeightsReview -- shown as its own collapsible box (matching
// ExtractionSection's visual style) once the doctor has moved past the
// editable sliders, so the chosen weights stay visible instead of
// disappearing into the request. See docs/evidence-weighting-plan-v1.md.

import React, { useState } from 'react';
import { buildSliderDefs } from './EvidenceWeightsReview';

const fadeInClass = "transition-opacity duration-1000 ease-in-out";

const WeightsSummaryBox = ({ specialty, weights, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const sliderDefs = buildSliderDefs(specialty.articleScoring);

  return (
    <div className={`w-full md:w-1/2 bg-surface-50 shadow-lg rounded-lg p-4 mb-4 ${fadeInClass} ${className}`}>
      <div className="mb-1 flex justify-between items-center">
        <div className="flex items-center">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <h2 className="text-xs font-medium text-gray-700 ml-2">Evidence weights confirmed</h2>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          {isExpanded ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          )}
        </button>
      </div>
      {isExpanded && (
        <div className="flex flex-col space-y-1">
          {sliderDefs.map(def => {
            const value = weights[def.key];
            const defaultValue = specialty.articleScoring.fields.find(f => f.key === def.key)?.points
              ?? specialty.articleScoring[def.key];
            const changed = value !== defaultValue;
            return (
              <div key={def.key} className="flex items-center justify-between gap-2" title={def.description}>
                <label className="text-[10px] font-light text-gray-700">{def.label}</label>
                <span className={`text-[10px] font-medium ${changed ? 'text-blue-600' : 'text-gray-500'}`}>
                  {value}{changed && <span className="text-gray-400"> (default {defaultValue})</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WeightsSummaryBox;
