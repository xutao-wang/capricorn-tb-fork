import React, {useState} from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import CaseInputSection from './CaseInputSection';
import * as api from '../../utils/api';
jest.mock('../../utils/api', () => ({ analyzeMedicalImage: jest.fn(), processLabPDF: jest.fn(), redactSensitiveInfo: jest.fn() }));
const draft = {previewImage:'data:image/jpeg;base64,c3ludGhldGlj',parsedFindings:{modality:'CXR', technicalQuality:'adequate', findings:[{name:'cavitation',status:'present',location:'right upper lung',description:'Synthetic observation'},{name:'consolidation',status:'indeterminate'},{name:'bilateral_extent',status:'absent'},{name:'miliary_pattern',status:'not_assessable'}]}, actionableEvents:['cavitation'],reviewRequired:true};
function Harness({submit}) { const [notes,setNotes]=useState('synthetic notes'); const [labs,setLabs]=useState(''); return <CaseInputSection caseNotes={notes} setCaseNotes={setNotes} labResults={labs} setLabResults={setLabs} handleExtract={submit} handleClearAll={()=>{}} showCaseInput numArticles={1} setNumArticles={()=>{}} />; }
beforeEach(()=>jest.clearAllMocks());
async function upload() { fireEvent.click(screen.getByRole('button',{name:/upload.*cxr/i})); const file=new File(['synthetic'], 'synthetic.png',{type:'image/png'}); fireEvent.change(screen.getByLabelText(/select imaging file/i),{target:{files:[file]}}); await screen.findByRole('heading',{name:/draft imaging observations/i}); }
test('typing does not redact and submission passes current text directly', () => {const submit=jest.fn();render(<Harness submit={submit}/>);fireEvent.change(screen.getByLabelText('Case notes'),{target:{value:'whoar eyou'}});fireEvent.click(screen.getByRole('button',{name:'Submit case'}));expect(submit).toHaveBeenCalledWith('whoar eyou','');expect(api.redactSensitiveInfo).not.toHaveBeenCalled();});
test('image remains a draft until explicit confirmation; editing and removing invalidate it', async()=>{api.analyzeMedicalImage.mockResolvedValue(draft);const submit=jest.fn();render(<Harness submit={submit}/>);await upload();expect(screen.getByLabelText('Case notes')).toHaveValue('synthetic notes');expect(screen.getByRole('button',{name:'Submit case'})).toBeDisabled();expect(screen.getByText(/indeterminate/)).toBeInTheDocument();const phenotype=screen.getByLabelText('Reviewed positive phenotypes');fireEvent.change(phenotype,{target:{value:'cavitation in reviewed location'}});fireEvent.click(screen.getByRole('button',{name:/confirm reviewed findings/i}));fireEvent.click(screen.getByRole('button',{name:'Submit case'}));expect(submit.mock.calls[0][0]).toContain('cavitation in reviewed location');expect(submit.mock.calls[0][0]).not.toContain('data:image');fireEvent.change(phenotype,{target:{value:'edited cavitation'}});expect(screen.getByRole('button',{name:'Submit case'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:/remove image/i}));fireEvent.click(screen.getByRole('button',{name:'Submit case'}));expect(submit.mock.calls[1][0]).toBe('synthetic notes');});
test('no positive image does not invent actionable phenotypes',async()=>{api.analyzeMedicalImage.mockResolvedValue({...draft,actionableEvents:[],parsedFindings:{...draft.parsedFindings,findings:draft.parsedFindings.findings.map(f=>({...f,status:'indeterminate'}))}});render(<Harness submit={jest.fn()}/>);await upload();expect(screen.getByLabelText('Reviewed positive phenotypes')).toHaveValue('');expect(screen.queryByText('Cavitary TB')).not.toBeInTheDocument();});

test('replacing a reviewed image blocks submission until new review',async()=>{api.analyzeMedicalImage.mockResolvedValue(draft);render(<Harness submit={jest.fn()}/>);await upload();fireEvent.click(screen.getByRole('button',{name:/confirm reviewed findings/i}));expect(screen.getByRole('button',{name:'Submit case'})).not.toBeDisabled();await upload();expect(screen.getByRole('button',{name:'Submit case'})).toBeDisabled();});
test('image service failure blocks submission until the selected image is removed',async()=>{api.analyzeMedicalImage.mockRejectedValue(Error('untrusted failure'));render(<Harness submit={jest.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/upload.*cxr/i}));fireEvent.change(screen.getByLabelText(/select imaging file/i),{target:{files:[new File(['synthetic'],'synthetic.png',{type:'image/png'})]}});await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Submit case'})).toBeDisabled();expect(screen.queryByText(/untrusted failure/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Remove image'}));expect(screen.getByRole('button',{name:'Submit case'})).not.toBeDisabled();});

test('review provenance follows reconfirmed replacement and disappears on removal',async()=>{
 api.analyzeMedicalImage.mockResolvedValue({...draft,model:'gemini-3.8-flash',metadata:{Format:'PNG',PatientName:'private'}});
 const submit=jest.fn();render(<Harness submit={submit}/>);await upload();
 fireEvent.click(screen.getByRole('button',{name:/confirm reviewed findings/i}));
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));
 expect(submit.mock.calls[0][2]).toEqual({model:'gemini-3.8-flash',modality:'CXR',technicalQuality:'adequate',rendering:{Format:'PNG'}});
 fireEvent.change(screen.getByLabelText('Reviewed positive phenotypes'),{target:{value:'edited synthetic finding'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));expect(submit).toHaveBeenCalledTimes(1);
 api.analyzeMedicalImage.mockResolvedValue({...draft,model:'gemini-3.8-flash',parsedFindings:{...draft.parsedFindings,modality:'CT_SLICE',technicalQuality:'limited'},metadata:{Format:'DICOM'}});
 await upload();expect(screen.getByRole('button',{name:'Submit case'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:/confirm reviewed findings/i}));
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));
 expect(submit.mock.calls[1][2]).toEqual({model:'gemini-3.8-flash',modality:'CT_SLICE',technicalQuality:'limited',rendering:{Format:'DICOM'}});
 fireEvent.click(screen.getByRole('button',{name:'Remove image'}));
 fireEvent.click(screen.getByRole('button',{name:'Submit case'}));
 expect(submit.mock.calls[2]).toEqual(['synthetic notes','']);
});
