export const APP_INTRODUCTION = 'I am Capricorn, a research assistant for reviewing clinical case information and finding relevant literature. Add case notes or review draft image observations, then confirm evidence weights before searching. Imaging observations require human review and are not a diagnosis.';

export const isAppIntroduction = text => /^(whoareyou|whoryou|whatareyou|whatcanyoudo|tellmeaboutyourself|introduceyourself|whatiscapricorn)$/.test(
  String(text).toLowerCase().replace(/[^a-z]/g, ''),
);

const noResultProse = new RegExp([
  '^(?:unable\\b|cannot\\b|can\'t\\b|could not\\b|there (?:is|are) no\\b|',
  'no (?:specific |identifiable |clear |actionable |clinical |relevant )?(?:disease|diagnosis|condition|medical|clinical|actionable|events?|findings?|case|information)\\b|',
  'not (?:a |an |enough |sufficient )?(?:clinical|medical|provided|specified|available)\\b|',
  'i\\s+(?:cannot|can\'t|could not|am unable|am an?\\b)|sorry\\b|',
  'the (?:provided|input|text|request)\\b|this (?:input|text|request)\\b|',
  'insufficient\\b|please provide\\b|error\\b|failed (?:to |request|extraction|processing)|model error\\b)',
].join(''), 'i');
const missingTerms = new Set(['none', 'null', 'n/a', 'unknown', 'not applicable', '[]']);
const isMissing = text => !text || missingTerms.has(text.toLowerCase().replace(/[.!]+$/, '')) || noResultProse.test(text);

const cleanTerm = value => {
  if (typeof value !== 'string') return '';
  let text = value.trim();
  const quotePairs = { "'": "'", '"': '"', '“': '”' };
  for (let depth = 0; depth < 3; depth += 1) {
    const closingQuote = quotePairs[text[0]];
    if (!closingQuote) break;
    if (text.length < 2 || text[text.length - 1] !== closingQuote) return '';
    text = text.slice(1, -1).trim();
  }
  return text;
};

// Validate every supported envelope, including the existing optional data wrapper.
// An explicitly false/malformed status cannot be repaired by a populated result.
const unwrapResult = (value, fields) => {
  let result = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    for (const flag of ['success', 'isClinicalCase']) {
      if (Object.prototype.hasOwnProperty.call(result, flag) && result[flag] !== true) return null;
    }
    if (result.error) return null;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(result, field)) return result[field];
    }
    result = result.data;
  }
  return null;
};

export const normalizeDisease = value => {
  const failure = () => new Error('No clinical disease was identified. Please review the case notes.');
  let result = value;
  if (typeof result === 'string' && /^[{["]/.test(result.trim())) {
    try {
      result = JSON.parse(result.trim());
    } catch {
      throw failure();
    }
  }
  const disease = cleanTerm(unwrapResult(result, ['disease']));
  if (isMissing(disease) || disease.length > 160 || disease.includes('\n')) throw failure();
  return disease;
};

const parseEventRepresentation = value => {
  const text = value.trim();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? [parsed] : parsed;
  } catch {
    // Legacy responses are an entire sequence of JSON strings, separated only
    // by whitespace. Consume every character so quoted prose cannot be a term.
    const quotedString = /"(?:[^"\\]|\\.)*"/y;
    const events = [];
    let position = 0;
    while (position < text.length) {
      quotedString.lastIndex = position;
      const match = quotedString.exec(text);
      if (!match) return null;
      try {
        events.push(JSON.parse(match[0]));
      } catch {
        return null;
      }
      position = quotedString.lastIndex;
      while (position < text.length && /\s/.test(text[position])) position += 1;
    }
    return events;
  }
};

export const normalizeEvents = value => {
  const representation = typeof value === 'string' ? parseEventRepresentation(value) : value;
  const events = unwrapResult(representation, ['events', 'actionableEvents']);
  if (!Array.isArray(events) || !events.length) {
    throw new Error('No actionable events were identified. Please review the case notes.');
  }
  const cleaned = events.map(cleanTerm);
  if (cleaned.some(event => isMissing(event) || event.length > 240)) {
    throw new Error('No actionable events were identified. Please review the case notes.');
  }
  return [...new Set(cleaned)];
};

export const isValidExtraction = (disease, events, specialty) => {
  try {
    return specialty?.isClinicalCase === true && !!normalizeDisease(disease) && normalizeEvents(events).length > 0;
  } catch {
    return false;
  }
};

const preparationMessages = {
  input: 'Please add clinical case information.',
  redaction: 'Redaction failed',
  specialty: 'Specialty detection failed',
  nonclinical: 'No clinical case was identified. Please add clinical case information.',
  disease: 'Disease extraction failed',
  events: 'Actionable-finding extraction failed',
  weights: 'Evidence weights could not be loaded',
  save: 'The case could not be saved',
  case: 'Case submission failed',
};

// Only application-owned messages and numeric HTTP statuses reach the banner.
// Provider errors can contain case content, so never display their raw text.
export class CasePreparationError extends Error {
  constructor(stage, cause) {
    const status = Number.isInteger(cause?.status) && cause.status >= 400 && cause.status <= 599 ? cause.status : undefined;
    const message = preparationMessages[stage] || preparationMessages.case;
    const guidance = status === 401 ? 'Please sign in again to continue.'
      : status === 403 ? 'Your Google account is not authorized for this action.'
      : 'Submission stopped; please try again.';
    super(['input', 'nonclinical'].includes(stage) ? message : `${message}${status ? ` (HTTP ${status})` : ''}. ${guidance}`);
    this.stage = stage;
    this.status = status;
  }
}

const prepareStage = async (stage, operation) => {
  try { return await operation(); }
  catch (error) { throw new CasePreparationError(stage, error); }
};

export const prepareClinicalCase = async (caseNotes, labResults, api) => {
  if (isAppIntroduction(caseNotes) && !labResults.trim()) return { kind: 'introduction', message: APP_INTRODUCTION };
  if (!caseNotes.trim() && !labResults.trim()) throw new CasePreparationError('input');
  let notes;
  let labs;
  try {
    // The redaction service permits one concurrent request; avoid competing
    // cold starts when both fields are populated.
    notes = caseNotes.trim() ? await api.redactSensitiveInfo(caseNotes, {reportError:false}) : '';
    labs = labResults.trim() ? await api.redactSensitiveInfo(labResults, {reportError:false}) : '';
    if (typeof notes !== 'string' || typeof labs !== 'string') throw new Error();
  } catch (error) {
    throw new CasePreparationError('redaction', error);
  }
  const combinedNotes = `Case Notes:\n${notes}\n\nLab Results:\n${labs}`;
  const detected = await prepareStage('specialty', () => api.detectSpecialty(combinedNotes, {reportError:false}));
  if (detected?.isClinicalCase !== true || !detected.specialtyId) {
    throw new CasePreparationError('nonclinical');
  }
  const [disease, events] = await Promise.all([
    prepareStage('disease', async () => normalizeDisease(await api.extractDisease(combinedNotes, detected.specialtyId, {reportError:false}))),
    prepareStage('events', async () => normalizeEvents(await api.extractEvents(combinedNotes, detected.specialtyId, {reportError:false}))),
  ]);
  return {
    kind: 'case',
    caseNotes: notes,
    labResults: labs,
    detected,
    disease,
    events,
  };
};
