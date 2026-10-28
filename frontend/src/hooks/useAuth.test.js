import { act, renderHook } from '@testing-library/react';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { useAuth } from './useAuth';
jest.mock('../firebase', () => ({ auth: {}, signInAnonymousUser: async () => null }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn(), signInWithPopup: jest.fn(), GoogleAuthProvider: class { addScope() {} }, signOut: jest.fn() }));
test('anonymous identities remain guests', () => {
 onAuthStateChanged.mockImplementation((auth, callback) => { callback({ isAnonymous: true }); return () => {}; });
 const { result } = renderHook(() => useAuth(() => {}));
 expect(result.current.isAuthenticated).toBe(false); expect(result.current.loading).toBe(false);
});
test('login failures are visible without leaking SDK error details', async () => {
 onAuthStateChanged.mockImplementation(() => () => {});
 signInWithPopup.mockRejectedValue(new Error('private credential data'));
 const { result } = renderHook(() => useAuth(() => {}));
 await act(async () => { await result.current.handleLogin(); });
 expect(result.current.authError).toBe('Google sign-in failed. Please try again.');
});
