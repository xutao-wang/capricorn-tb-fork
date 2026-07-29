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

const fadeInClass = "transition-opacity duration-1000 ease-in-out";

const ExtractionSection = ({
  extractedDisease,
  extractedEvents,
  setExtractedDisease,
  setExtractedEvents,
  detectedSpecialty,
  onExtractionComplete,
  className
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  // Ensure extractedEvents is always an array
  const events = Array.isArray(extractedEvents) ? extractedEvents : [];

  useEffect(() => {
    if (detectedSpecialty && extractedDisease && events.length > 0) {
      onExtractionComplete();
    }
  }, [detectedSpecialty, extractedDisease, events, onExtractionComplete]);

  return (
    <div className={`w-full md:w-1/2 bg-surface-50 shadow-lg rounded-lg p-4 mb-4 ${fadeInClass} ${className}`}>
      <div className="mb-1 flex justify-between items-center">
        <div className="flex items-center">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <h2 className="text-xs font-medium text-gray-700 ml-2">Specialty identified, disease and actionable events extracted</h2>
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
        <div className="flex flex-col space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-light text-gray-700 w-20">Specialty</label>
            <div className="relative flex-1">
              <div
                className="w-full p-1.5 border border-gray-300 rounded-lg text-xs h-8 flex items-center bg-gray-50 truncate"
                title={detectedSpecialty?.rationale || ''}
              >
                {detectedSpecialty?.label || ''}
              </div>
              {!detectedSpecialty && (
                <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
                  <span className="italic text-gray-400 text-[10px] font-light">Specialty will appear here after detection...</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-light text-gray-700 w-20">Extracted disease</label>
            <div className="relative flex-1">
              <textarea
                className="w-full p-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs h-8 resize-none overflow-y-auto"
                value={extractedDisease}
                onChange={(e) => setExtractedDisease(e.target.value)}
              />
              {!extractedDisease && (
                <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
                  <span className="italic text-gray-400 text-[10px] font-light">Disease will appear here after extraction...</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-light text-gray-700 w-20">Extracted events</label>
            <div className="relative flex-1">
              <textarea
                className="w-full p-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs h-16 resize-none overflow-y-auto"
                value={events.length > 0 ? events.join(', ') : ''}
                onChange={(e) => setExtractedEvents(e.target.value.split(',').map(event => event.trim()))}
              />
              {events.length === 0 && (
                <div className="absolute inset-0 p-1.5 pointer-events-none">
                  <span className="italic text-gray-400 text-[10px] font-light">Events will appear here after extraction...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExtractionSection;
