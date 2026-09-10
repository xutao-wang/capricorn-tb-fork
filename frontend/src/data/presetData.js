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

export const presetCaseNotes = `A now almost 4-year-old female diagnosed with KMT2A-rearranged AML and CNS2 involvement exhibited refractory disease after NOPHO DBH AML 2012 protocol. Post- MEC and ADE, MRD remained at 35% and 53%. Vyxeos-clofarabine therapy reduced MRD to 18%. Third-line FLAG-Mylotarg lowered MRD to 3.5% (flow) and 1% (molecular). After a cord blood HSCT in December 2022, she relapsed 10 months later with 3% MRD and femoral extramedullary disease.
After the iLTB discussion, in November 2023 the patient was enrolled in the SNDX5613 trial, receiving revumenib for three months, leading to a reduction in KMT2A MRD to 0.1% by PCR. Subsequently, the patient underwent a second allogeneic HSCT using cord blood with treosulfan, thiotepa, and fludarabine conditioning, followed by revumenib maintenance. In August 2024, 6.5 months after the second HSCT, the patient experienced a bone marrow relapse with 33% blasts. The patient is currently in very good clinical condition.`;

export const presetLabResults = `Diagnostic tests:			
						 							
  WES and RNAseq were performed on the 1st relapse sample showing KMT2A::MLLT3 fusion and NRAS (p.Gln61Lys) mutation.
 						
						 							
  Flow cytometry from the current relapse showed positive CD33 and CD123.
 						
						 							
  WES and RNAseq of the current relapse sample is pending.`;

export const presetTBCaseNotes = `42-year-old male presenting with persistent productive cough, hemoptysis, night sweats, and marked 8 kg weight loss over 3 months. Patient has a history of treated pulmonary TB 4 years ago. Posteroanterior (PA) chest radiograph shows extensive right upper lobe thick-walled cavitation with surrounding alveolar consolidation, volume loss, and bilateral apical tree-in-bud opacities. Comorbidities include uncontrolled type 2 diabetes mellitus (HbA1c 9.2%). Evaluated for multidrug-resistant tuberculosis (MDR-TB) and second-line therapeutic regimens.`;

export const presetTBLabResults = `Diagnostic Microbiology & Molecular Susceptibility Testing:
- Sputum AFB Smear: Positive (3+ acid-fast bacilli).
- GeneXpert MTB/RIF Ultra: Mycobacterium tuberculosis complex DETECTED (High); Rifampicin resistance DETECTED (rpoB S531L mutation).
- Line Probe Assay (GenoType MTBDRplus): katG S315T mutation detected (High-level Isoniazid resistance); inhA promoter wild-type.
- Second-Line Line Probe Assay (GenoType MTBDRsl): gyrA wild-type (Fluoroquinolones: Levofloxacin & Moxifloxacin susceptible); rrs wild-type (Aminoglycosides susceptible).
- MGIT 960 Liquid Culture: Confirmed MDR-TB (resistant to Isoniazid and Rifampicin, susceptible to Linezolid, Bedaquiline, Clofazimine, and Moxifloxacin).`;

export const presetTBFindings = {
  primaryImpression: "Extensive cavitary pulmonary tuberculosis of the right upper lobe with endobronchial dissemination and suspected drug-resistant etiology",
  cavitation: {
    detected: true,
    location: "Right upper lobe apical-posterior segment",
    description: "Thick-walled cavitary lesion measuring 3.8 x 3.2 cm with irregular inner contours and surrounding fibro-cavitary consolidation",
    clinicalSignificance: "Large apical cavity denotes high mycobacterial load, heightened transmission risk, delayed sputum conversion, and high risk of multidrug resistance"
  },
  parenchymalFindings: {
    consolidations: "Dense airspace consolidation in right apical-posterior segments with air bronchograms",
    infiltrates: "Patchy bilateral infiltrates predominantly in upper zones",
    treeInBud: "Centrilobular tree-in-bud branching nodular opacities in right middle and left upper lobes indicating active endobronchial dissemination",
    miliaryPattern: "None"
  },
  distributionAndSeverity: {
    laterality: "Bilateral",
    zonesInvolved: ["Right Upper", "Right Middle", "Left Upper"],
    severityGrade: "Far-Advanced Cavitary TB"
  },
  pleuralAndMediastinalFindings: {
    pleuralEffusion: "Small reactive right apical pleural thickening; no free effusion",
    pleuralThickening: "Apical capping right greater than left",
    lymphadenopathy: "Right hilar prominence suspicious for reactive lymphadenopathy"
  },
  drugResistanceAndTreatmentRisk: "Severe cavitary pathology and prior treatment history significantly increase risk of acquired drug resistance (MDR/XDR-TB). Rapid molecular DST and evaluation for WHO-recommended BPaL/BPaLM oral regimens warranted.",
  actionableEvents: [
    "Right upper lobe cavitation",
    "Dense apical consolidation",
    "Tree-in-bud nodular opacities",
    "Far-advanced cavitary pulmonary tuberculosis",
    "High mycobacterial bacillary burden",
    "Elevated risk for MDR-TB"
  ],
  radiologyReportText: "CHEST RADIOGRAPH (PA VIEW):\nSevere bilateral pulmonary abnormalities predominantly involving the right lung. There is a prominent 3.8 cm thick-walled cavitary lesion in the right upper lobe apical-posterior segment surrounded by dense alveolar consolidation and architectural volume loss. Multifocal centrilobular tree-in-bud opacities are seen in the right middle and left upper lobes, consistent with active endobronchial bronchogenic dissemination. No large pleural effusion or pneumothorax. Findings are classic for active, far-advanced cavitary pulmonary tuberculosis with high bacillary burden."
};

