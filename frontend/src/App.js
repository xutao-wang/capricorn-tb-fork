import React from 'react';
import {BrowserRouter,Route,Routes} from 'react-router-dom';
import MedicalAssistantUI from './MedicalAssistantUI';
import './App.css';

export default function App(){
 return <BrowserRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes><Route path="/" element={<MedicalAssistantUI/>}/></Routes></BrowserRouter>;
}
