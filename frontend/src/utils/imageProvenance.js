// Only reviewed technical provenance may be stored with an owner-scoped case.
export const reviewedImageProvenance = source => {
  if (!source || !/^gemini-[a-zA-Z0-9.-]{1,80}$/.test(source.model || '') ||
      !['CXR', 'CT_SLICE', 'UNKNOWN'].includes(source.modality) ||
      !['adequate', 'limited', 'uninterpretable'].includes(source.technicalQuality)) return null;
  const input = source.rendering || {};
  const rendering = {};
  const enums = {
    Format: ['PNG', 'JPEG', 'DICOM'], Modality: ['CT', 'CR', 'DX', 'UNKNOWN'],
    PhotometricInterpretation: ['MONOCHROME1', 'MONOCHROME2'],
    WindowSource: ['VOI_LUT', 'DICOM_WINDOW', 'CT_LUNG_DEFAULT', 'PIXEL_RANGE'],
    WindowFunction: ['LINEAR', 'LINEAR_EXACT', 'SIGMOID']
  };
  Object.entries(enums).forEach(([key, values]) => { if (values.includes(input[key])) rendering[key] = input[key]; });
  ['OriginalDimensions', 'PreviewDimensions'].forEach(key => {
    if (typeof input[key] === 'string' && /^[1-9]\d{0,4}x[1-9]\d{0,4}$/.test(input[key])) {
      const [width, height] = input[key].split('x').map(Number);
      if (width * height <= 16000000 && (key !== 'PreviewDimensions' || Math.max(width, height) <= 2048)) rendering[key] = input[key];
    }
  });
  ['WindowCenter', 'WindowWidth'].forEach(key => {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && Math.abs(input[key]) <= 1000000 && (key !== 'WindowWidth' || input[key] > 0)) rendering[key] = input[key];
  });
  return { model: source.model, modality: source.modality, technicalQuality: source.technicalQuality, rendering };
};
