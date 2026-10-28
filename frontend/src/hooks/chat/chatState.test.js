import {initializeActiveChat,handleChatSelect} from './chatState';
import {createNewChat,getChatMessages} from '../../firebase';
import {reviewedImageProvenance} from '../../utils/imageProvenance';
jest.mock('../../firebase',()=>({createNewChat:jest.fn(async()=> 'synthetic-chat'),getChatMessages:jest.fn()}));
jest.mock('./messageHandlers',()=>({createMessageId:()=> 'synthetic-message'}));
const provenance={model:'gemini-3.8-flash',modality:'CT_SLICE',technicalQuality:'limited',rendering:{Format:'DICOM',Modality:'CT',OriginalDimensions:'256x256',PreviewDimensions:'256x256',WindowCenter:-600,WindowWidth:1500,WindowFunction:'LINEAR',WindowSource:'CT_LUNG_DEFAULT',PhotometricInterpretation:'MONOCHROME1'}};
test('owner-scoped case preserves only bounded technical reviewed provenance through persistence and reload',async()=>{
 const unsafe={...provenance,previewImage:'data:image/private',fileName:'private.dcm',summaryText:'unreviewed draft',rendering:{...provenance.rendering,PatientName:'private patient',PatientID:'private identifier',WindowWidth:Infinity}};
 const expected={...provenance,rendering:{...provenance.rendering}};delete expected.rendering.WindowWidth;
 await initializeActiveChat({user:{uid:'synthetic-owner'},caseNotes:'Reviewed synthetic phenotypes',labResults:'',extractedDisease:'Tuberculosis',extractedEvents:['cavitation'],reviewedImageProvenance:unsafe,setActiveChat:jest.fn(),setChatHistory:jest.fn()});
 const [owner,messages]=createNewChat.mock.calls[0];expect(owner).toBe('synthetic-owner');
 expect(JSON.parse(messages[0].content).reviewedImageProvenance).toEqual(expected);
 getChatMessages.mockResolvedValue(messages);
 const setHistory=jest.fn();
 await handleChatSelect({chat:{id:'synthetic-chat'},userId:owner,setActiveChat:jest.fn(),setHasDocumentMessages:jest.fn(),setChatHistory:setHistory});
 expect(setHistory.mock.calls[0][0][0].initialCase.reviewedImageProvenance).toEqual(expected);
 expect(JSON.stringify(messages)).not.toMatch(/private|previewImage|fileName|summaryText|Patient/);
});
test.each([
 {...provenance,model:'private unbounded model'},
 {...provenance,modality:'private modality'},
 {...provenance,technicalQuality:'private quality'},
])('invalid provenance is excluded %#',source=>expect(reviewedImageProvenance(source)).toBeNull());
test('unbounded dimensions and rendering strings are excluded',()=>{
 expect(reviewedImageProvenance({...provenance,rendering:{OriginalDimensions:'99999x99999',PreviewDimensions:'9999x1',WindowSource:'private',WindowCenter:'private'}}).rendering).toEqual({});
});
