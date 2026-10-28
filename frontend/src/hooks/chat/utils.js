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

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export const getLatestMessages = async (userId, chatId) => {
  if (!userId || !chatId) {

    return [];
  }
  try {
    const chatRef = doc(db, `chats/${userId}/conversations/${chatId}`);
    const chatDoc = await getDoc(chatRef);
    if (chatDoc.exists()) {
      return chatDoc.data().messages || [];
    }
    return [];
  } catch (error) {

    throw new Error('Conversation could not be read. Please try again.');
  }
};
