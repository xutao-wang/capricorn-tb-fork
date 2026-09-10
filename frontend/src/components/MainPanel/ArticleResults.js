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

const ArticleResults = ({ 
  articles, 
  initialExpanded = true, 
  currentProgress, 
  totalArticles, 
  processedArticles 
}) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  // Debug logging
  console.log('[ArticleResults] Rendering with props:', {
    articlesLength: articles?.length,
    hasArticles: !!articles?.length,
    currentProgress,
    totalArticles,
    processedArticles,
    articles: articles
  });

  if (!articles?.length && !currentProgress) {
    console.log('[ArticleResults] Returning null - no articles and no progress');
    return null;
  }

  console.log('[ArticleResults] Will render component');

  return (
    <div className="mt-4 bg-surface-50 shadow-lg rounded-lg p-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-sm font-medium text-gray-700">Retrieved articles</h2>
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
      
      {currentProgress && (
        <div className="mb-4">
          <div className="text-sm text-gray-600 mb-2">Currently processing:</div>
          <div className="text-xs flex items-center gap-2 mb-1">
            <span className="text-gray-600">{currentProgress}</span>
          </div>
          <div style={{ maxWidth: '400px' }}>
            <div className="bg-gray-200 rounded-full h-2 mb-4 overflow-hidden">
              <div
                className="bg-surface-700 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(processedArticles / totalArticles) * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {isExpanded && articles?.length > 0 && (
        <div className="overflow-x-scroll" style={{ maxWidth: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Full Article</th>
                <th className="px-4 py-2 text-xs border-t font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">Points</th>
              </tr>
            </thead>
            <tbody>
              {[...articles].sort((a, b) => b.points - a.points).map((article, index) => {
                const pointsBreakdown = Object.entries(article.point_breakdown || {})
                  .map(([k,v]) => `${k.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}: ${v > 0 ? '+' : ''}${v}`)
                  .join(' | ');

                return (
                  <tr key={index}>
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
                      {article.events.map((event, i) => (
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
                    <td className="px-4 py-2 text-xs border-t text-gray-500">
                      <button
                        onClick={() => {
                          const newWindow = window.open('', '_blank');
                          newWindow.document.write(`
                            <!DOCTYPE html>
                            <html>
                              <head>
                                <title>Full Article</title>
                                <script src="https://cdn.tailwindcss.com"></script>
                              </head>
                              <body>
                                <div class="min-h-screen bg-gray-50 py-8 px-4">
                                  <div class="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-6">
                                    <button onclick="window.close()" class="mb-4 text-blue-500 hover:text-blue-700">← Back to Table</button>
                                    <div class="prose max-w-none">
                                      <p class="whitespace-pre-wrap text-gray-700 text-lg leading-relaxed">${article.content}</p>
                                    </div>
                                  </div>
                                </div>
                              </body>
                            </html>
                          `);
                          newWindow.document.close();
                        }}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                      >
                        View Article
                      </button>
                    </td>
                    <td className="px-4 py-2 text-xs border-t text-gray-500">
                      <button
                        onClick={() => {
                          const newWindow = window.open('', '_blank');
                          newWindow.document.write(`
                            <!DOCTYPE html>
                            <html>
                              <head>
                                <title>Points Details</title>
                                <script src="https://cdn.tailwindcss.com"></script>
                              </head>
                              <body>
                                <div class="min-h-screen bg-gray-50 py-8 px-4">
                                  <div class="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-6">
                                    <button onclick="window.close()" class="mb-4 text-blue-500 hover:text-blue-700">← Back to Table</button>
                                    <div class="space-y-4">
                                      <h2 class="text-2xl font-bold text-gray-800">Points Details</h2>
                                      <div class="text-4xl font-bold text-blue-600">${Math.round(article.points)} Points</div>
                                      <div class="space-y-2">
                                        ${pointsBreakdown.split(' | ').map(item => {
                                          const [label, value] = item.split(': ');
                                          return `
                                            <div class="flex justify-between items-center py-2 border-b">
                                              <span class="text-gray-600">${label}</span>
                                              <span class="font-semibold ${value.startsWith('+') ? 'text-green-600' : 'text-red-600'}">${value}</span>
                                            </div>
                                          `;
                                        }).join('')}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </body>
                            </html>
                          `);
                          newWindow.document.close();
                        }}
                        className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                      >
                        <span className="font-bold">{Math.round(article.points)}</span>
                        <span className="text-blue-500">ℹ️</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ArticleResults;
