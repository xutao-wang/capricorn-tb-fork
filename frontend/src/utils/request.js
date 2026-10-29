import { auth } from '../firebase';

export const REQUEST_ERROR_EVENT = 'capricorn-request-error';
const requestFailure = (reportError, message, status) => {
  if (reportError) window.dispatchEvent(new CustomEvent(REQUEST_ERROR_EVENT, { detail: message }));
  throw Object.assign(new Error(message), { status });
};

// Resolve the identity and ID token for every request; never cache credentials.
export const authenticatedFetch = async (url, options = {}) => {
  const { reportError = true, ...fetchOptions } = options;
  const fail = (message, status) => requestFailure(reportError, message, status);
  if (!url || !url.trim()) return fail('This endpoint is not configured. Please contact the administrator.');
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return fail('Please sign in with Google to continue.', 401);
  let token;
  try { token = await user.getIdToken(); } catch { return fail('Please sign in again to continue.', 401); }
  if (!token) return fail('Please sign in again to continue.', 401);
  const headers = new Headers(fetchOptions.headers);
  headers.set('Authorization', `Bearer ${token}`);
  let response;
  try { response = await fetch(url, { ...fetchOptions, headers }); }
  catch { return fail('Network request failed. Please try again.'); }
  if (response.status === 401) return fail('Please sign in again to continue.', 401);
  if (response.status === 403) return fail('Access denied. Your Google account is not authorized for this action.', 403);
  if (!response.ok) return fail(`Request failed (HTTP ${response.status}). Please try again.`, response.status);
  return response;
};
