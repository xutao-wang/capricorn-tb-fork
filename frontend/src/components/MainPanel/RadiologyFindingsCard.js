import React, {useEffect, useState} from 'react';

export default function RadiologyFindingsCard({findingsData,previewUrl,onRemove,onReviewChange}) {
 const [expanded,setExpanded]=useState(false);
 const positive=(findingsData.parsedFindings?.findings || []).filter(f=>f.status==='present');
 const initial=positive.map(f=>[f.name.replace(/_/g,' '),f.location,f.description].filter(Boolean).join(': ')).join('\n');
 const [reviewText,setReviewText]=useState(initial);
 const [confirmed,setConfirmed]=useState(false);
 useEffect(()=>{ setReviewText(initial);setConfirmed(false); },[findingsData,initial]);
 return <section className="border rounded-lg p-4 mb-4 bg-indigo-50" aria-label="Imaging review">
  <div className="flex justify-between"><h3>Draft imaging observations — human review required</h3><button type="button" onClick={onRemove}>Remove image</button></div>
  <p>Research observations only. Image findings do not establish tuberculosis, drug resistance, or treatment.</p>
  <p>Modality: {findingsData.parsedFindings?.modality || 'UNKNOWN'}; technical quality: {findingsData.parsedFindings?.technicalQuality || 'uninterpretable'}</p>
  {previewUrl && <button type="button" onClick={()=>setExpanded(!expanded)} aria-label="Expand image preview"><img src={previewUrl} alt="Uploaded imaging preview" className={expanded?'max-h-screen':'max-h-48'} /></button>}
  <ul>{(findingsData.parsedFindings?.findings || []).map(f=><li key={f.name}>{f.name.replace(/_/g,' ')}: {f.status}{f.location?` — ${f.location}`:''}{f.description?` — ${f.description}`:''}</li>)}</ul>
  {!positive.length && <p>No positive phenotypes were proposed. Review image quality and provide clinical context; no event has been inferred.</p>}
  <label className="block">Reviewed positive phenotypes<textarea aria-label="Reviewed positive phenotypes" value={reviewText} className="block w-full border p-2" onChange={e=>{setReviewText(e.target.value);setConfirmed(false);onReviewChange?.(null);}} /></label>
  <button type="button" onClick={()=>{setConfirmed(true);onReviewChange?.(reviewText.trim());}} className="mt-2 border rounded px-3 py-2">Confirm reviewed findings</button>
  <p role="status">{confirmed?'Findings reviewed. Any edits require confirmation again.':'Draft awaiting review confirmation.'}</p>
 </section>;
}
