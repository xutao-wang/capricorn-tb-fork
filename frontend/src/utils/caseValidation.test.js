import { isAppIntroduction, normalizeDisease, normalizeEvents, prepareClinicalCase } from './caseValidation';
test.each(['who are you?', 'whoar eyou', ' Who   ARE YOU ', 'what can you do?'])('recognizes local introduction %s', text => expect(isAppIntroduction(text)).toBe(true));
test.each(['No disease identified', 'Error extracting disease', 'Unable to determine a disease', '', { disease: null }, 'There is no clinical case to analyze.'])('rejects invalid disease %#', value => expect(() => normalizeDisease(value)).toThrow());
test.each(['No actionable events found.', 'A patient has a complicated case.', 'Error processing request', [], { events: ['No actionable events identified'] }])('rejects invalid events %#', value => expect(() => normalizeEvents(value)).toThrow());
test('supports typed and quoted events without accepting arbitrary prose', () => {
 expect(normalizeDisease({ disease: 'Tuberculosis' })).toBe('Tuberculosis');
 expect(normalizeEvents({ events: ['cavitation'] })).toEqual(['cavitation']);
 expect(normalizeEvents('"cavitation" "consolidation"')).toEqual(['cavitation','consolidation']);
});
const services = () => ({ redactSensitiveInfo: jest.fn(async text => `safe ${text}`), detectSpecialty: jest.fn(async () => ({ isClinicalCase: true, specialtyId: 'tb' })), extractDisease: jest.fn(async () => 'Tuberculosis'), extractEvents: jest.fn(async () => '"cavitation"') });
test('introduction uses no remote services', async () => { const api=services(); expect((await prepareClinicalCase('whoar eyou','',api)).kind).toBe('introduction'); Object.values(api).forEach(fn => expect(fn).not.toHaveBeenCalled()); });
test('redaction failure stops classification and extraction', async () => { const api=services(); api.redactSensitiveInfo.mockRejectedValue(Error('private')); await expect(prepareClinicalCase('synthetic case','',api)).rejects.toThrow(/redact/i); expect(api.detectSpecialty).not.toHaveBeenCalled(); });
test.each([false, undefined])('nonclinical or missing classification prevents extraction %s', async isClinicalCase => { const api=services(); api.detectSpecialty.mockResolvedValue({isClinicalCase,specialtyId:'tb'}); await expect(prepareClinicalCase('synthetic case','',api)).rejects.toThrow(/clinical/i); expect(api.extractDisease).not.toHaveBeenCalled(); });
test('uses returned redacted variables and validates extraction before returning a case', async () => { const api=services(); const result=await prepareClinicalCase('synthetic case','synthetic lab',api); expect(result.caseNotes).toBe('safe synthetic case'); expect(api.extractDisease.mock.calls[0][0]).toContain('safe synthetic lab'); api.extractEvents.mockResolvedValue('No actionable events found'); await expect(prepareClinicalCase('synthetic case','',api)).rejects.toThrow(); });
test.each([{success:false,events:['cavitation']},{success:false,data:{events:['cavitation']}},'The input "who are you?" does not describe clinical events','No events found: "cavitation"'])('rejects failure envelopes and prose around quoted terms %#',value=>expect(()=>normalizeEvents(value)).toThrow());
test('rejects failed typed disease even when a disease field is present',()=>expect(()=>normalizeDisease({success:false,disease:'Tuberculosis'})).toThrow());

describe('review regressions: clinical response semantics', () => {
  test.each([
    { isClinicalCase: false, disease: 'Tuberculosis' },
    { data: { isClinicalCase: false, disease: 'Tuberculosis' } },
    { data: { success: false, disease: 'Tuberculosis' } },
    { data: { error: 'synthetic failure', disease: 'Tuberculosis' } },
    { success: null, disease: 'Tuberculosis' },
    'No diagnosis',
    '"No diagnosis"',
    "'No diagnosis'",
    'No condition identified',
    'not applicable',
    'null',
    'The provided text does not describe a clinical case',
    '{"disease":"Tuberculosis"',
    '"Tuberculosis" trailing prose',
  ])('rejects nonclinical or incomplete disease representation %#', value => {
    expect(() => normalizeDisease(value)).toThrow();
  });

  test.each([
    { isClinicalCase: false, events: ['cavitation'] },
    { data: { isClinicalCase: false, events: ['cavitation'] } },
    { data: { success: false, events: ['cavitation'] } },
    { data: { error: 'synthetic failure', events: ['cavitation'] } },
    { success: null, events: ['cavitation'] },
    { events: ['No diagnosis'] },
    { events: ['not applicable'] },
    { events: ['null'] },
    { events: ['No findings'] },
    '["cavitation"',
    '"cavitation" trailing prose',
    'The input "cavitation" does not describe clinical events',
    '"cavitation",',
  ])('rejects nonclinical or incomplete event representation %#', value => {
    expect(() => normalizeEvents(value)).toThrow();
  });

  test('preserves medically meaningful punctuation in typed and legacy terms', () => {
    expect(normalizeDisease({ disease: 'C. difficile infection' })).toBe('C. difficile infection');
    expect(normalizeDisease('"C. difficile infection"')).toBe('C. difficile infection');
    expect(normalizeDisease('Carcinoma of unknown primary')).toBe('Carcinoma of unknown primary');
    expect(normalizeEvents({ events: ['BRAF p.V600E', 'PD-L1 TPS 50%'] })).toEqual([
      'BRAF p.V600E', 'PD-L1 TPS 50%',
    ]);
    expect(normalizeEvents('"BRAF p.V600E"\n"PD-L1 TPS 50%"')).toEqual([
      'BRAF p.V600E', 'PD-L1 TPS 50%',
    ]);
    expect(normalizeEvents('["BRAF p.V600E","PD-L1 TPS 50%"]')).toEqual([
      'BRAF p.V600E', 'PD-L1 TPS 50%',
    ]);
  });
});
