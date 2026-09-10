// Copyright 2026 Google LLC
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

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Maximize2, X, Activity } from 'lucide-react';

const RadiologyFindingsCard = ({ findingsData, previewUrl, onRemove }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  if (!findingsData) return null;

  const {
    primaryImpression,
    cavitation,
    severity,
    actionableEvents = [],
    parsedFindings = {},
    metadata = {}
  } = findingsData;

  const hasCavity = cavitation?.detected || (typeof cavitation === 'boolean' && cavitation);

  return (
    <>
      <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-blue-200 rounded-xl p-4 mb-4 shadow-sm transition-all duration-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          {/* Left: Thumbnail Preview & Lightbox Trigger */}
          <div className="flex items-center space-x-3">
            {previewUrl && (
              <div
                className="relative group cursor-pointer w-20 h-20 rounded-lg overflow-hidden border border-gray-300 bg-black flex-shrink-0 shadow-sm"
                onClick={() => setShowLightbox(true)}
              >
                <img
                  src={previewUrl}
                  alt="Thoracic Scan Preview"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-opacity flex items-center justify-center">
                  <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                  <Activity className="w-3 h-3 mr-1" />
                  {metadata?.Modality ? `DICOM (${metadata.Modality})` : 'Thoracic Radiograph'}
                </span>
                {severity && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    severity.toLowerCase().includes('severe') || severity.toLowerCase().includes('far')
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {severity}
                  </span>
                )}
                {hasCavity ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Cavitary TB Phenotype
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                    No Cavitation
                  </span>
                )}
              </div>

              <h4 className="text-sm font-semibold text-gray-900 mt-1.5 line-clamp-2">
                {primaryImpression || 'Multimodal Thoracic Image Analysis'}
              </h4>

              {cavitation?.location && (
                <p className="text-xs text-red-700 mt-0.5 font-medium">
                  Cavitation: {cavitation.location} ({cavitation.description || 'Thick-walled'})
                </p>
              )}
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center space-x-2 self-end md:self-center">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
            >
              {isExpanded ? (
                <>
                  Less Details <ChevronUp className="w-3.5 h-3.5 ml-1" />
                </>
              ) : (
                <>
                  Full Findings <ChevronDown className="w-3.5 h-3.5 ml-1" />
                </>
              )}
            </button>
            {onRemove && (
              <button
                onClick={onRemove}
                title="Remove scan"
                className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Actionable Events Tag Cloud */}
        {actionableEvents.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-blue-100">
            <span className="text-xs font-semibold text-gray-600 mr-2">Extracted Phenotypes:</span>
            <div className="inline-flex flex-wrap gap-1.5 mt-1">
              {actionableEvents.map((evt, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white text-blue-800 border border-blue-200 shadow-2xs"
                >
                  <CheckCircle2 className="w-2.5 h-2.5 text-blue-500 mr-1" />
                  {evt}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Expanded Detailed Breakdown */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-blue-100 text-xs text-gray-700 space-y-2 bg-white p-3 rounded-lg border border-blue-100">
            {parsedFindings?.distributionAndSeverity && (
              <div>
                <span className="font-semibold text-gray-800">Distribution:</span>{' '}
                {parsedFindings.distributionAndSeverity.laterality} (Zones:{' '}
                {parsedFindings.distributionAndSeverity.zonesInvolved?.join(', ') || 'N/A'})
              </div>
            )}
            {parsedFindings?.parenchymalFindings && (
              <div>
                <span className="font-semibold text-gray-800">Parenchyma:</span>{' '}
                Consolidations: {parsedFindings.parenchymalFindings.consolidations || 'None'};{' '}
                Tree-in-Bud: {parsedFindings.parenchymalFindings.treeInBud || 'None'};{' '}
                Miliary: {parsedFindings.parenchymalFindings.miliaryPattern || 'None'}
              </div>
            )}
            {parsedFindings?.drugResistanceAndTreatmentRisk && (
              <div>
                <span className="font-semibold text-gray-800">Resistance & Treatment Risk:</span>{' '}
                {parsedFindings.drugResistanceAndTreatmentRisk}
              </div>
            )}
            {metadata && Object.keys(metadata).length > 0 && (
              <div className="pt-2 border-t border-gray-100 text-[11px] text-gray-500">
                <span className="font-semibold">Metadata:</span>{' '}
                {Object.entries(metadata).map(([k, v]) => `${k}: ${v}`).join(' | ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {showLightbox && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowLightbox(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-black rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-black bg-opacity-60 text-white hover:bg-opacity-90 transition-all z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={previewUrl}
              alt="High Resolution Radiograph"
              className="max-h-[85vh] w-auto mx-auto object-contain"
            />
            <div className="p-3 bg-gray-900 text-white text-xs flex justify-between items-center">
              <span>{primaryImpression}</span>
              {metadata?.OriginalDimensions && <span>{metadata.OriginalDimensions}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RadiologyFindingsCard;
