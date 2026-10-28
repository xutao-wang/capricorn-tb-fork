import React, {useState,useEffect,useRef} from 'react';
import {processLabPDF,analyzeMedicalImage} from '../../utils/api';
import {DEFAULT_ARTICLES,MAX_ARTICLES,clampArticleCount} from '../../utils/config';
import {presetCaseNotes,presetLabResults,presetTBCaseNotes,presetTBLabResults} from '../../data/presetData';
import ImageInputModal from '../Modal/ImageInputModal';
import LabInputModal from '../Modal/LabInputModal';
import RadiologyFindingsCard from './RadiologyFindingsCard';

const readFile = file => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('File could not be read.'));reader.readAsDataURL(file);});
export default function CaseInputSection({caseNotes='',setCaseNotes,labResults='',setLabResults,isProcessing,handleExtract,handleExampleLoad,showCaseInput,handleClearAll,numArticles=DEFAULT_ARTICLES,setNumArticles}) {
 const [showImage,setShowImage]=useState(false);
 const [showLabChoice,setShowLabChoice]=useState(false);
 const [showLabs,setShowLabs]=useState(!!labResults);
 const [draft,setDraft]=useState(null);
 const [preview,setPreview]=useState(null);
 const [reviewedText,setReviewedText]=useState(null);
 const [imageSelected,setImageSelected]=useState(false);
 const [busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const [demo,setDemo]=useState(false);
 const [listening,setListening]=useState(false);
 const recognition=useRef(null);
 const fileInput=useRef(null);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current+=1;recognition.current?.abort();},[]);
 const removeImage=()=>{generation.current+=1;setDraft(null);setPreview(null);setReviewedText(null);setImageSelected(false);setBusy('');};
 const loadDemo=()=>{removeImage();setShowImage(false);setDemo(true);setCaseNotes(presetTBCaseNotes);setLabResults(presetTBLabResults);setShowLabs(true);handleExampleLoad?.(presetTBCaseNotes,presetTBLabResults);};
 const uploadImage=async file=>{
  if(file.size>5*1024*1024){setError('Imaging files must be 5 MiB or smaller.');return;}
  const request=++generation.current;
  setShowImage(false);setImageSelected(true);setDraft(null);setPreview(null);setReviewedText(null);setError('');setBusy('Preparing draft imaging observations…');
  try {const data=await readFile(file);const result=await analyzeMedicalImage(data.split(',')[1],file.name,'tuberculosis');if(request!==generation.current)return;if(!result?.parsedFindings || !Array.isArray(result.parsedFindings.findings))throw Error();setDraft(result);setPreview(result.previewImage || (file.type.startsWith('image/')?data:null));}
  catch{if(request===generation.current)setError('Image analysis failed. Replace or remove the image before submitting.');}
  finally{if(request===generation.current)setBusy('');}
 };
 const uploadLab=async event=>{const file=event.target.files[0];if(!file)return;setError('');setBusy('Processing lab report…');try{const data=await readFile(file);const result=await processLabPDF(data.split(',')[1]);if(typeof result!=='string')throw Error();setLabResults(result);setShowLabs(true);}catch{setError('Lab report processing failed. Please try again.');}finally{setBusy('');event.target.value='';}};
 const toggleSpeech=()=>{if(listening){recognition.current?.stop();setListening(false);return;}const Speech=window.SpeechRecognition || window.webkitSpeechRecognition;if(!Speech){setError('Speech recognition is unavailable in this browser.');return;}const instance=new Speech();recognition.current=instance;instance.continuous=true;instance.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal){const text=e.results[i][0].transcript;setCaseNotes(current=>`${current} ${text}`.trim());}}};instance.onend=()=>setListening(false);instance.onerror=()=>{setError('Speech recognition failed.');setListening(false);};instance.start();setListening(true);};
 const submit=()=>{if(busy || isProcessing || (imageSelected && reviewedText===null))return;const notes=[caseNotes,reviewedText?`[Reviewed imaging phenotypes]:\n${reviewedText}`:''].filter(Boolean).join('\n\n');handleExtract(notes,labResults);};
 if(!showCaseInput)return null;
 return <section className="bg-white border rounded-xl p-4 sm:p-6 mt-12 mb-8 shadow-sm max-h-[65vh] overflow-auto">
  {busy && <p role="status">{busy}</p>}
  {draft && <RadiologyFindingsCard findingsData={draft} previewUrl={preview} onRemove={removeImage} onReviewChange={setReviewedText}/>}
  {imageSelected && !draft && !busy && <button type="button" onClick={removeImage}>Remove image</button>}
  {demo && <p role="note">Canned text demonstration — no image analysis was performed. This example does not establish clinical accuracy.</p>}
  <textarea aria-label="Case notes" placeholder="Enter clinical case notes, or upload a CXR / selected CT slice" className="w-full min-h-24 p-2" value={caseNotes} onChange={e=>setCaseNotes(e.target.value)}/>
  {showLabs && <textarea aria-label="Lab results" placeholder="Enter lab results" className="w-full p-2 border-t" value={labResults} onChange={e=>setLabResults(e.target.value)}/>}
  <div className="flex flex-wrap gap-3 items-center mt-3">
   <button type="button" onClick={()=>setShowLabChoice(true)}>Add labs</button>
   <button type="button" onClick={()=>setShowImage(true)}>Upload CXR / selected CT slice</button>
   <label htmlFor="numArticles">Articles</label><input id="numArticles" type="number" min="1" max={MAX_ARTICLES} value={numArticles} onChange={e=>setNumArticles(clampArticleCount(e.target.value))} className="w-12 border"/>
   <button type="button" onClick={loadDemo}>Canned TB text demo</button>
   <button type="button" onClick={()=>{removeImage();setDemo(true);setCaseNotes(presetCaseNotes);setLabResults(presetLabResults);setShowLabs(true);}}>Canned leukemia text demo</button>
   <button type="button" onClick={()=>{removeImage();setDemo(false);setError('');setCaseNotes('');setLabResults('');handleClearAll();}}>Clear</button>
   <button type="button" onClick={toggleSpeech}>{listening?'Stop dictation':'Dictate'}</button>
   <button type="button" aria-label="Submit case" onClick={submit} disabled={!!busy || isProcessing || (imageSelected && reviewedText===null)} className="bg-blue-700 text-white rounded px-3 py-2 disabled:opacity-50">{isProcessing?'Processing…':'Submit case'}</button>
  </div>
  {error && <p role="alert">{error}</p>}
  <input ref={fileInput} type="file" accept=".pdf" onChange={uploadLab} hidden/>
  <ImageInputModal isOpen={showImage} onClose={()=>setShowImage(false)} onFileSelect={uploadImage} onLoadSample={loadDemo}/>
  <LabInputModal isOpen={showLabChoice} onClose={()=>setShowLabChoice(false)} onUploadClick={()=>{setShowLabChoice(false);fileInput.current?.click();}} onTextClick={()=>{setShowLabChoice(false);setShowLabs(true);}}/>
 </section>;
}
