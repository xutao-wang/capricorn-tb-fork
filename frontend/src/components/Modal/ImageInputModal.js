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

import React, { useRef, useState } from 'react';
import { Upload, FileImage, Sparkles, X, AlertCircle } from 'lucide-react';

const ImageInputModal = ({ isOpen, onClose, onFileSelect, onLoadSample }) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState(null);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const validateAndProcessFile = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setDragError('Imaging files must be 5 MiB or smaller.'); return; }
    const name = file.name.toLowerCase();
    const isDicom = name.endsWith('.dcm') || name.endsWith('.dicom') || file.type === 'application/dicom';
    const isImage = ['image/png','image/jpeg','image/webp'].includes(file.type) || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');

    if (!isDicom && !isImage) {
      setDragError('Please upload a valid DICOM (.dcm) or standard image file (.png, .jpg).');
      return;
    }

    setDragError(null);
    onFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length > 1) { setDragError('Upload one selected image or CT slice; complete series are unsupported.'); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center space-x-2">
            <FileImage className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-gray-800">Add Thoracic Imaging</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-xs text-gray-500 mb-4">
            Upload one chest X-ray or one selected CT slice. Single-frame DICOM and PNG/JPEG/WebP are supported. Complete CT series, multi-frame images, and archives are unsupported. Draft observations require your review before case extraction.
          </p>

          {/* Hidden input */}
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Select imaging file"
            accept=".dcm,.dicom,.png,.jpg,.jpeg,.webp,application/dicom,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                validateAndProcessFile(e.target.files[0]);
              }
            }}
            style={{ display: 'none' }}
          />

          {/* Drag & Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
          >
            <Upload className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <span className="text-sm font-medium text-gray-700 block">
              Drag & Drop DICOM or Image
            </span>
            <span className="text-xs text-gray-400 mt-1 block">
              Single frame, up to 5 MiB and 16 million decoded pixels; preview up to 2048 px
            </span>
          </div>

          {dragError && (
            <div className="flex items-center text-red-600 text-xs mt-3 bg-red-50 p-2 rounded">
              <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
              {dragError}
            </div>
          )}

          {/* Preset Sample Option */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => {
                if (typeof onLoadSample === 'function') {
                  onLoadSample();
                }
              }}
              className="w-full flex items-center justify-center px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-blue-800 rounded-lg hover:from-blue-100 hover:to-indigo-100 transition-colors text-xs font-medium group"
            >
              <Sparkles className="w-4 h-4 mr-2 text-blue-600 group-hover:scale-110 transition-transform" />
              Load canned TB text demo (no image inference)
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-gray-600 hover:text-gray-800 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageInputModal;
