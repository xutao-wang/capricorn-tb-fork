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

import React, { useState } from 'react';

const StreamedArticleResults = ({ currentProgress, article, initialExpanded = true }) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  // Extract progress numbers from currentProgress if available
  const progressMatch = currentProgress?.match(/Processing article (\d+) of (\d+)/);
  const currentArticle = progressMatch ? parseInt(progressMatch[1]) : 0;
  const totalArticles = progressMatch ? parseInt(progressMatch[2]) : 0;
  const progressPercentage = totalArticles > 0 ? (currentArticle / totalArticles) * 100 : 0;

  if (!article) {
    return null;
  }

  return (
    <div className="mt-4 bg-surface-50 shadow-lg rounded-lg p-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-sm font-medium text-gray-700">Streamed Article Results</h2>
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
        <>
          {/* Progress bar */}
      <div className="mt-2" style={{ maxWidth: '400px' }}>
        <div className="text-xs flex items-center gap-2 mb-1">
          <span className="text-gray-600">{currentProgress}</span>
          {totalArticles > 0 && (
            <span className="text-blue-600 font-medium">
              {progressPercentage.toFixed(0)}%
            </span>
          )}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
      </div>

          {/* Current article table */}
          <div className="mt-4 overflow-x-scroll" style={{ maxWidth: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="min-w-max bg-white border border-gray-300" style={{ minWidth: '120%' }}>
          <thead>
            <tr>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">PMCID</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Title</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Year</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Condition / Disease</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Paper Type</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Actionable Events</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Drugs Tested</th>
              <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Drug Results</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-2 text-xs border-t text-gray-500 max-h-20 overflow-y-auto">
                <a href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${article.pmcid}/`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                  {article.pmcid}
                </a>
              </td>
              <td className="px-4 py-2 text-xs border-t text-gray-500" style={{ maxHeight: '80px', overflowY: 'auto', display: 'block', minWidth: '200px', padding: '8px 16px' }}>{article.title}</td>
              <td className="px-4 py-2 text-xs border-t text-gray-500">{article.year}</td>
              <td className="px-4 py-2 text-xs border-t text-gray-500" style={{ maxHeight: '80px', overflowY: 'auto', display: 'block', minWidth: '150px', padding: '8px 16px' }}>{article.cancer}</td>
              <td className="px-4 py-2 text-xs border-t text-gray-500">{article.type}</td>
              <td className="px-4 py-2 text-xs border-t text-gray-500" style={{ maxHeight: '80px', overflowY: 'auto', display: 'block', minWidth: '200px', padding: '8px 16px' }}>
                {article.events?.map((event, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && ', '}
                    <span className={event.matches_query ? 'font-bold text-green-600' : ''}>
                      {event.event}
                    </span>
                  </React.Fragment>
                ))}
              </td>
              <td className="px-4 py-2 text-xs border-t text-gray-500">{article.drugs_tested ? 'Yes' : 'No'}</td>
              <td className="px-4 py-2 text-xs border-t text-gray-500" style={{ maxHeight: '80px', overflowY: 'auto', display: 'block', minWidth: '250px', padding: '8px 16px' }}>{article.drug_results?.join(', ') || 'None'}</td>
            </tr>
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
};

export default StreamedArticleResults;
