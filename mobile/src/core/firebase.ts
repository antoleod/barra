import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  Firestore,
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { ScanRecord } from '../types';

interface FirebaseRuntime {
  enabled: boolean;
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  source: 'env' | 'none';
}

let runtime: FirebaseRuntime | null = null;

function env(name: string): string {
  return String((process.env as Record<string, string | undefined>)[name] || '').trim();
}

function readConfigFromEnv() {
  const apiKey = env('EXPO_PUBLIC_FIREBASE_API_KEY');
  const authDomain = env('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN');
  const projectId = env('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
  const appId = env('EXPO_PUBLIC_FIREBASE_APP_ID');
  const storageBucket = env('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET');
  const messagingSenderId = env('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');

  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId, storageBucket, messagingSenderId };
}

export async function initFirebaseRuntime(): Promise<FirebaseRuntime> {
  if (runtime) return runtime;

  const config = readConfigFromEnv();
  if (!config) {
    runtime = { enabled: false, app: null, auth: null, db: null, source: 'none' };
    return runtime;
  }

  const app = getApps().length ? getApp() : initializeApp(config);
  const auth: Auth = getAuth(app);
  const db = getFirestore(app);
  runtime = { enabled: true, app, auth, db, source: 'env' };
  return runtime;
}

export async function onFirebaseAuthState(cb: (user: Auth['currentUser']) => void) {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(rt.auth, (u) => cb(u));
}

export async function loginWithEmail(email: string, password: string) {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) throw new Error('Firebase disabled');
  try {
    const res = await signInWithEmailAndPassword(rt.auth, email.trim(), password);
    return res.user;
  } catch (e) {
    const code = (e as { code?: string }).code || '';
    if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
      const created = await createUserWithEmailAndPassword(rt.auth, email.trim(), password);
      return created.user;
    }
    throw e;
  }
}

export async function logoutFirebase() {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) return;
  await signOut(rt.auth);
}

export async function syncScansWithFirebase(local: ScanRecord[]) {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth || !rt.db) throw new Error('Firebase unavailable');
  const user = rt.auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const uid = user.uid;
  const scansRef = collection(rt.db, 'users', uid, 'scans');

  let pushed = 0;
  for (const scan of local.filter((x) => x.status === 'pending')) {
    const docId = `${scan.profileId}_${scan.codeNormalized}_${new Date(scan.date).getTime()}`.replace(/[^A-Za-z0-9_-]/g, '_');
    await setDoc(doc(scansRef, docId), { ...scan, uid, updatedAt: serverTimestamp() }, { merge: true });
    pushed += 1;
  }

  const snap = await getDocs(query(scansRef));
  const server: ScanRecord[] = [];
  snap.forEach((d) => {
    const x = d.data() as ScanRecord;
    if (!x.id) x.id = d.id;
    server.push(x);
  });

  return { pushed, server };
}
