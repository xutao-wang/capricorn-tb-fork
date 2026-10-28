// These tests require a local emulator and never connect to a real project.
const { initializeApp, deleteApp } = require('firebase/app');
const { test, beforeEach, after } = require('node:test');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { getFirestore, connectFirestoreEmulator, setLogLevel, doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

const projectId = 'demo-capricorn-local';
const address = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(address)) {
  throw new Error('Run these tests only against a loopback Firestore emulator.');
}
const [host, port] = address.split(':');
const databaseId = 'capricorn-dev';
const approvedEmail = process.env.CAPRICORN_TEST_EMAIL || 'owner@example.org';
const apps = [];
setLogLevel('silent');
const claims = (email = approvedEmail, provider = 'google.com', verified = true) => ({
  sub: 'owner-uid', email, email_verified: verified, firebase: { sign_in_provider: provider },
});
function database(token) {
  const app = initializeApp({ projectId }, `named-rule-test-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app, databaseId);
  connectFirestoreEmulator(db, host, Number(port), token ? { mockUserToken: token } : {});
  return db;
}
const approved = () => database(claims());

beforeEach(async () => {
  const response = await fetch(`http://${address}/emulator/v1/projects/${projectId}/databases/${databaseId}/documents`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Local named database reset failed');
});
after(async () => { await Promise.all(apps.map(deleteApp)); });

test('guests cannot read or create chats', async () => {
  const db = database();
  await assertFails(getDoc(doc(db, 'chats/owner-uid/conversations/test')));
  await assertFails(setDoc(doc(db, 'chats/owner-uid/conversations/test'), { synthetic: true }));
});

test('anonymous, unverified, and unapproved identities cannot access app data', async () => {
  for (const token of [claims(approvedEmail, 'anonymous'),
                       claims(approvedEmail, 'google.com', false),
                       claims('stranger@example.org')]) {
    const db = database(token);
    await assertFails(getDoc(doc(db, 'specialties/general-medicine')));
    await assertFails(setDoc(doc(db, 'chats/owner-uid/conversations/test'), { synthetic: true }));
  }
});

test('approved users can store their own chats and cannot access another UID', async () => {
  const db = approved();
  await assertSucceeds(setDoc(doc(db, 'chats/owner-uid/conversations/test'), { synthetic: true }));
  await assertSucceeds(getDoc(doc(db, 'chats/owner-uid/conversations/test')));
  await assertFails(getDoc(doc(db, 'chats/other-uid/conversations/test')));
  await assertFails(setDoc(doc(db, 'chats/other-uid/conversations/test'), { synthetic: true }));
});

test('evidence presets retain UID ownership', async () => {
  const db = approved();
  await assertSucceeds(setDoc(doc(db, 'users/owner-uid/weightPresets/test'), { synthetic: true }));
  await assertFails(setDoc(doc(db, 'users/other-uid/weightPresets/test'), { synthetic: true }));
});

test('approved users can edit specialties while history remains immutable', async () => {
  const db = approved();
  const specialty = doc(db, 'specialties/synthetic');
  const history = doc(db, 'specialties/synthetic/history/version-1');
  await assertSucceeds(setDoc(specialty, { label: 'Synthetic' }));
  await assertSucceeds(setDoc(history, { label: 'Synthetic' }));
  await assertSucceeds(updateDoc(specialty, { label: 'Synthetic edited' }));
  await assertFails(updateDoc(history, { label: 'Changed snapshot' }));
  await assertFails(deleteDoc(history));
  await assertFails(deleteDoc(specialty));
});

test('unmatched collections deny access even to approved users', async () => {
  await assertFails(setDoc(doc(approved(), 'unmatched/test'), { synthetic: true }));
});
