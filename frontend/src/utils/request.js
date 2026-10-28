import { auth } from '../firebase';

export const REQUEST_ERROR_EVENT = 'capricorn-request-error';
const fail = message => {
  window.dispatchEvent(new CustomEvent(REQUEST_ERROR_EVENT, { detail: message }));
  throw new Error(message);
};

// Resolve the identity and ID token for every request; never cache credentials.
export const authenticatedFetch = async (url, options = {}) => {
  if (!url || !url.trim()) return fail('This endpoint is not configured. Please contact the administrator.');
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return fail('Please sign in with Google to continue.');
  let token;
  try { token = await user.getIdToken(); } catch { return fail('Please sign in again to continue.'); }
  if (!token) return fail('Please sign in again to continue.');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  let response;
  try { response = await fetch(url, { ...options, headers }); }
  catch { return fail('Network request failed. Please try again.'); }
  if (response.status === 401) return fail('Please sign in again to continue.');
  if (response.status === 403) return fail('Access denied. Your Google account is not authorized for this action.');
  if (!response.ok) return fail(`Request failed (HTTP ${response.status}). Please try again.`);
  return response;
};
