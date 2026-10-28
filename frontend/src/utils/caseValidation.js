export const APP_INTRODUCTION = 'I am Capricorn, a research assistant for reviewing clinical case information and finding relevant literature. Add case notes or review draft image observations, then confirm evidence weights before searching. Imaging observations require human review and are not a diagnosis.';
export const isAppIntroduction = text => /^(whoareyou|whoryou|whatareyou|whatcanyoudo|tellmeaboutyourself|introduceyourself|whatiscapricorn)$/.test(String(text).toLowerCase().replace(/[^a-z]/g,''));
const invalid = text => !text || /\b(no (?:actionable |clinical |specific |identifiable |relevant )?(?:disease|events?|case|information)|not (?:a |an )?(?:clinical|medical)|no.*(?:identified|found|provided)|unable|cannot|can't|error|failed|insufficient|please provide|not provided|unknown|none|n\/a)\b/i.test(text);
const cleanTerm = value => typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g,'').trim() : '';
export const normalizeDisease = value => {
 if(value && typeof value==='object' && (value.success===false || value.error)) throw Error('No clinical disease was identified.');
 const disease=cleanTerm(typeof value === 'object' && value ? value.disease ?? value.data?.disease : value);
 if(invalid(disease) || disease.length>160 || /[\n.!?]/.test(disease)) throw Error('No clinical disease was identified. Please review the case notes.');
 return disease;
};
export const normalizeEvents = value => {
 if(value && typeof value==='object' && (value.success===false || value.error)) throw Error('No actionable events were identified.');
 let events;
 if(Array.isArray(value)) events=value;
 else if(value && typeof value==='object') events=value.events ?? value.actionableEvents ?? value.data?.events;
 else if(typeof value==='string') {
  try { return normalizeEvents(JSON.parse(value)); } catch(error) { /* legacy quoted terms below */ }
  const matches=[...value.matchAll(/"([^"\n]+)"/g)];
  const remainder=value.replace(/"[^"\n]+"/g,'').replace(/[\s,;\[\]]/g,'');
  if(matches.length && !remainder) events=matches.map(match=>match[1]);
 }
 if(!Array.isArray(events) || !events.length || events.some(event=>invalid(cleanTerm(event)) || cleanTerm(event).length>240 || /[\n.!?]/.test(cleanTerm(event)))) throw Error('No actionable events were identified. Please review the case notes.');
 return [...new Set(events.map(cleanTerm))];
};
export const isValidExtraction = (disease,events,specialty) => { try { return specialty?.isClinicalCase===true && !!normalizeDisease(disease) && normalizeEvents(events).length>0; } catch { return false; } };
export const prepareClinicalCase = async (caseNotes, labResults, api) => {
 if(isAppIntroduction(caseNotes) && !labResults.trim()) return {kind:'introduction',message:APP_INTRODUCTION};
 if(!caseNotes.trim() && !labResults.trim()) throw Error('Please add clinical case information.');
 let notes,labs;
 try { [notes,labs]=await Promise.all([caseNotes.trim()?api.redactSensitiveInfo(caseNotes):'',labResults.trim()?api.redactSensitiveInfo(labResults):'']); if(typeof notes!=='string'||typeof labs!=='string') throw Error(); } catch {throw Error('Redaction failed. Submission stopped; please try again.');}
 const combinedNotes=`Case Notes:\n${notes}\n\nLab Results:\n${labs}`;
 const detected=await api.detectSpecialty(combinedNotes);
 if(detected?.isClinicalCase!==true || !detected.specialtyId) throw Error('No clinical case was identified. Please add clinical case information.');
 const [disease,events]=await Promise.all([api.extractDisease(combinedNotes,detected.specialtyId),api.extractEvents(combinedNotes,detected.specialtyId)]);
 return {kind:'case',caseNotes:notes,labResults:labs,detected,disease:normalizeDisease(disease),events:normalizeEvents(events)};
};
