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

// src/hooks/useAuth.js
import { useCallback, useState, useEffect } from 'react';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { REQUEST_ERROR_EVENT } from '../utils/request';

export const useAuth = (setShowUserMenu) => {
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleLogin = useCallback(async () => {

    setAuthError('');
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    try {

      const result = await signInWithPopup(auth, provider);

      const user = result.user;
      const displayName = user.displayName || '';
      const firstName = displayName.split(' ')[0];
      setFirstName(firstName);
      setIsAuthenticated(!user.isAnonymous);

    } catch (error) {
      const message = 'Google sign-in failed. Please try again.';
      setAuthError(message);
      window.dispatchEvent(new CustomEvent(REQUEST_ERROR_EVENT, { detail: message }));
      setIsAuthenticated(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
      setShowUserMenu(false);
    } catch (error) {

    }
  }, [setShowUserMenu]);

  // Set up auth state listener
  useEffect(() => {

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {

      if (firebaseUser) {

        setUser(firebaseUser);
        const displayName = firebaseUser.displayName || '';
        const firstName = displayName.split(' ')[0];
        setFirstName(firstName);
        setIsAuthenticated(!firebaseUser.isAnonymous);
      } else {

        setUser(null);
        setFirstName('');
        setIsAuthenticated(false);
      }
      setLoading(false);
    });

    return () => {

      unsubscribe();
    };
  }, []);

  return { authError, user, firstName, loading, handleLogin, handleLogout, isAuthenticated };
};
