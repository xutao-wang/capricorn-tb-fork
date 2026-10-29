import { auth } from '../firebase';
import { authenticatedFetch } from './request';
jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
beforeEach(() => { global.fetch = jest.fn(); auth.currentUser = null; });
test('missing endpoint prevents network', async () => {
 await expect(authenticatedFetch()).rejects.toThrow(/configured/i); expect(fetch).not.toHaveBeenCalled();
});
test.each([null, { isAnonymous: true }])('guest prevents network', async user => {
 auth.currentUser = user; await expect(authenticatedFetch('/paid')).rejects.toThrow(/sign in/i); expect(fetch).not.toHaveBeenCalled();
});
test('token failure prevents network and hides sensitive error', async () => {
 auth.currentUser = { getIdToken: async () => { throw Error('secret'); } };
 await expect(authenticatedFetch('/paid')).rejects.toThrow('Please sign in again to continue.'); expect(fetch).not.toHaveBeenCalled();
});
test('fresh tokens preserve caller options and stream response', async () => {
 const response = { ok: true, body: {} }; fetch.mockResolvedValue(response);
 const getIdToken = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second'); auth.currentUser = { getIdToken };
 const options = { method: 'POST', body: 'body', headers: { 'X-Test': 'preserved' } };
 expect(await authenticatedFetch('/paid', options)).toBe(response); await authenticatedFetch('/paid', options);
 expect(getIdToken).toHaveBeenCalledTimes(2);
 expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer first');
 expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer second');
 expect(fetch.mock.calls[0][1].headers.get('X-Test')).toBe('preserved'); expect(fetch.mock.calls[0][1].body).toBe('body');
});
test.each([401,403])('status %s hides body', async status => {
 auth.currentUser = { getIdToken: async () => 'token' }; const json = jest.fn(); fetch.mockResolvedValue({ ok: false, status, json });
 await expect(authenticatedFetch('/paid')).rejects.toThrow(status === 401 ? /sign in/i : /access/i); expect(json).not.toHaveBeenCalled();
});
test('network exceptions show a safe message rather than raw exception bodies',async()=>{
 auth.currentUser={getIdToken:async()=> 'synthetic-token'};fetch.mockRejectedValue(Error('untrusted private body'));
 await expect(authenticatedFetch('/local')).rejects.toThrow('Network request failed. Please try again.');
});


test.each([401,403,422,429,503])('safe request errors retain HTTP status %s for submission diagnostics', async status => {
 auth.currentUser={getIdToken:async()=> 'synthetic-token'};
 fetch.mockResolvedValue({ok:false,status});
 await expect(authenticatedFetch('/local')).rejects.toMatchObject({status});
});


test('a workflow-owned failure throws safely without broadcasting a competing global error', async () => {
 auth.currentUser={getIdToken:async()=> 'synthetic-token'};
 fetch.mockResolvedValue({ok:false,status:503});
 const listener=jest.fn();
 window.addEventListener('capricorn-request-error', listener);
 try {
  await expect(authenticatedFetch('/local',{reportError:false})).rejects.toMatchObject({status:503});
  expect(listener).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0][1]).not.toHaveProperty('reportError');
 } finally { window.removeEventListener('capricorn-request-error',listener); }
});
