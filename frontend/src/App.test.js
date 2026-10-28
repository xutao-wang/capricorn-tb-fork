import React from 'react';
import {render,screen} from '@testing-library/react';
import App from './App';
jest.mock('./MedicalAssistantUI',()=>()=> <div>Clinical research workspace</div>);
jest.mock('firebase/app',()=>({initializeApp:()=>{throw Error('App must use the shared Firebase initialization');}}));
test('renders the research workspace without duplicate Firebase initialization',()=>{render(<App/>);expect(screen.getByText('Clinical research workspace')).toBeInTheDocument();});
