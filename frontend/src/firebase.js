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

// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';

// Your Firebase configuration object
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get Auth and Firestore instances
export const auth = getAuth(app);
const databaseId = process.env.REACT_APP_FIREBASE_DATABASE_ID;
if (!databaseId) {
  throw new Error('REACT_APP_FIREBASE_DATABASE_ID must be configured explicitly.');
}
export const db = getFirestore(app, databaseId);

// Helper functions for chat operations
// In firebase.js
export const createNewChat = async (userId, initialMessages) => {
  try {
    const chatRef = await addDoc(collection(db, `chats/${userId}/conversations`), {
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: initialMessages,
      template: 'default'
    });
    return chatRef.id;
  } catch (error) {

    throw error;
  }
};

export const addMessageToChat = async (userId, chatId, message) => {
  try {
    const chatRef = doc(db, `chats/${userId}/conversations/${chatId}`);
    await updateDoc(chatRef, {
      messages: [...message],  // Firestore will merge this with existing messages
      updatedAt: new Date()
    });
  } catch (error) {

    throw error;
  }
};

export const getUserChats = async (userId) => {
  try {
    const chatsRef = collection(db, `chats/${userId}/conversations`);
    const q = query(chatsRef, orderBy('updatedAt', 'desc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {

    throw error;
  }
};

export const updateChatTitle = async (userId, chatId, newTitle) => {
  try {
    const chatRef = doc(db, `chats/${userId}/conversations/${chatId}`);
    await updateDoc(chatRef, {
      title: newTitle,
      updatedAt: new Date()
    });
  } catch (error) {

    throw error;
  }
};

export const deleteChat = async (userId, chatId) => {
  try {
    const chatRef = doc(db, `chats/${userId}/conversations/${chatId}`);
    await deleteDoc(chatRef);
  } catch (error) {

    throw error;
  }
};

export const getChatMessages = async (userId, chatId) => {
  try {
    const chatRef = doc(db, `chats/${userId}/conversations/${chatId}`);
    const chatDoc = await getDoc(chatRef);

    if (chatDoc.exists()) {
      const chatData = chatDoc.data();
      return chatData.messages || [];
    } else {

      return [];
    }
  } catch (error) {

    throw error;
  }
};

// Anonymous authentication
export const signInAnonymousUser = async () => {
  try {
    const userCredential = await signInAnonymously(auth);
    return userCredential.user;
  } catch (error) {

    return null;
  }
};

export const getChatDocumentsRealTime = (userId, callback) => {
  const chatsRef = collection(db, `chats/${userId}/conversations`);
  const q = query(chatsRef, orderBy('updatedAt', 'desc'));

  return onSnapshot(q, (querySnapshot) => {
    const chats = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(chats);
  }, (error) => {

  });
};

// Specialty personas -- see docs/persona-system-plan.md at the repo root
export const getSpecialties = async () => {
  try {
    const specialtiesRef = collection(db, 'specialties');
    const querySnapshot = await getDocs(specialtiesRef);
    return querySnapshot.docs.map(doc => doc.data());
  } catch (error) {

    throw error;
  }
};

// Fetches one specialty's full config (persona, event categories,
// articleScoring rubric) -- used to populate the evidence-weights slider
// panel with the detected specialty's current default values.
export const getSpecialtyById = async (specialtyId) => {
  try {
    const specialtyRef = doc(db, `specialties/${specialtyId}`);
    const specialtyDoc = await getDoc(specialtyRef);
    return specialtyDoc.exists() ? specialtyDoc.data() : null;
  } catch (error) {

    throw error;
  }
};

export const createSpecialty = async (specialty) => {
  try {
    const specialtyRef = doc(db, `specialties/${specialty.id}`);
    await setDoc(specialtyRef, specialty);
  } catch (error) {

    throw error;
  }
};

// Edits an existing specialty (curated or auto-generated). Writes a
// snapshot of the pre-edit doc to a history subcollection first, so a bad
// edit can be manually recovered -- see docs/persona-generation-plan.md.
export const updateSpecialty = async (specialtyId, updatedFields, editorUid) => {
  try {
    const specialtyRef = doc(db, `specialties/${specialtyId}`);
    const currentDoc = await getDoc(specialtyRef);
    if (currentDoc.exists()) {
      const historyRef = doc(collection(db, `specialties/${specialtyId}/history`));
      await setDoc(historyRef, {
        ...currentDoc.data(),
        snapshotAt: new Date(),
        replacedBy: editorUid || null,
      });
    }
    await updateDoc(specialtyRef, {
      ...updatedFields,
      lastEditedBy: editorUid || null,
      lastEditedAt: new Date(),
    });
  } catch (error) {

    throw error;
  }
};

// Named evidence-weight presets a doctor can save and reapply across cases
// (e.g. "Genomics Heavy", "Clinic Heavy") -- scoped per specialty since the
// factor keys themselves are specialty-specific. See
// docs/weight-presets-plan.md at the repo root. Anonymous users never call
// these (no persistence across sessions for them, by the same rule pattern
// used for specialty edits).
export const getUserWeightPresets = async (uid, specialtyId) => {
  try {
    const presetsRef = collection(db, `users/${uid}/weightPresets`);
    const q = query(presetsRef, where('specialtyId', '==', specialtyId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {

    throw error;
  }
};

export const saveUserWeightPreset = async (uid, specialtyId, label, weights) => {
  try {
    const presetsRef = collection(db, `users/${uid}/weightPresets`);
    const presetRef = await addDoc(presetsRef, {
      label,
      specialtyId,
      weights,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return presetRef.id;
  } catch (error) {

    throw error;
  }
};

export const deleteUserWeightPreset = async (uid, presetId) => {
  try {
    await deleteDoc(doc(db, `users/${uid}/weightPresets/${presetId}`));
  } catch (error) {

    throw error;
  }
};

export default app;
