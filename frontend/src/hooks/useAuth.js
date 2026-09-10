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
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { signInAnonymousUser } from '../firebase';

export const useAuth = (setShowUserMenu) => {
  const [user, setUser] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  const auth = getAuth();

  const handleLogin = useCallback(async () => {
    console.log('[AUTH_DEBUG] handleLogin called');
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    try {
      console.log('[AUTH_DEBUG] Attempting to sign in with popup');
      const result = await signInWithPopup(auth, provider);
      console.log('[AUTH_DEBUG] Sign in successful, user:', result.user);
      const user = result.user;
      const displayName = user.displayName || '';
      const firstName = displayName.split(' ')[0];
      setFirstName(firstName);
      setIsAuthenticated(true);
      setAuthError(null);
      console.log('[AUTH_DEBUG] Authentication state updated:', { firstName, isAuthenticated: true });
    } catch (error) {
      console.error('[AUTH_DEBUG] Error signing in with Google:', error);
      setIsAuthenticated(false);
      if (error.code === 'auth/operation-not-allowed') {
        const msg = 'Google Sign-in is not yet enabled in the Firebase Console.\n\nPlease enable it under:\nFirebase Console -> Authentication -> Sign-in method -> Google.';
        setAuthError(msg);
        alert(msg);
      } else if (error.code === 'auth/popup-blocked') {
        const msg = 'The sign-in popup was blocked by your browser. Please allow popups for this site.';
        setAuthError(msg);
        alert(msg);
      } else if (error.code !== 'auth/popup-closed-by-user') {
        setAuthError(error.message);
        alert(`Authentication error: ${error.message}`);
      }
    }
  }, [auth]);

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
      setShowUserMenu(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }, [auth, setShowUserMenu]);

  // Set up auth state listener
  useEffect(() => {
    console.log('[AUTH_MENU_DEBUG] useAuth: Setting up auth state listener');
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('[AUTH_MENU_DEBUG] useAuth: Auth state changed:', {
        hasUser: !!firebaseUser,
        isAnonymous: firebaseUser?.isAnonymous,
        uid: firebaseUser?.uid
      });

      if (firebaseUser && !firebaseUser.isAnonymous) {
        console.log('[AUTH_MENU_DEBUG] useAuth: Authenticated user detected:', firebaseUser.uid);
        setUser(firebaseUser);
        const displayName = firebaseUser.displayName || '';
        const firstName = displayName.split(' ')[0] || 'Doctor';
        setFirstName(firstName);
        setIsAuthenticated(true);
      } else if (firebaseUser && firebaseUser.isAnonymous) {
        console.log('[AUTH_MENU_DEBUG] useAuth: Existing user is anonymous guest');
        setUser(firebaseUser);
        setFirstName('');
        setIsAuthenticated(false);
      } else {
        console.log('[AUTH_MENU_DEBUG] useAuth: No user, signing in anonymously');
        try {
          const anonymousUser = await signInAnonymousUser();
          console.log('[AUTH_MENU_DEBUG] useAuth: Anonymous sign in result:', {
            success: !!anonymousUser,
            uid: anonymousUser?.uid,
            isAnonymous: anonymousUser?.isAnonymous
          });
          setUser(anonymousUser);
          setFirstName('');
          setIsAuthenticated(false);
        } catch (error) {
          console.error('[AUTH_MENU_DEBUG] useAuth: Anonymous sign in error:', error);
          setIsAuthenticated(false);
        }
      }
      setLoading(false);
    });

    return () => {
      console.log('[AUTH_MENU_DEBUG] useAuth: Cleaning up auth state listener');
      unsubscribe();
    };
  }, [auth]);

  console.log('[AUTH_MENU_DEBUG] useAuth: Current auth state:', { user, isAuthenticated, firstName });

  return { user, firstName, loading, handleLogin, handleLogout, isAuthenticated };
};
