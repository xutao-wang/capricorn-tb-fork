import React from 'react';
import {render,screen} from '@testing-library/react';
import ExtractionSection from './ExtractionSection';
import AnalysisSection from './AnalysisSection';
test('pending extraction does not claim success',()=>{const {container}=render(<ExtractionSection extractedDisease="" extractedEvents={[]} onExtractionComplete={()=>{}}/>);expect(screen.queryByText(/identified, disease/)).not.toBeInTheDocument();expect(container.querySelector('.text-green-500')).toBeNull();});
test('pending paper retrieval does not show success',()=>{const {container}=render(<AnalysisSection extractedDisease="" extractedEvents={[]} articles={[]} setIsBox3Hovered={()=>{}}/>);expect(container.querySelector('.text-green-500')).toBeNull();});
