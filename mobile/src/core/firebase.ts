import { Platform } from 'react-native';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User,
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

const REQUIRED_FIREBASE_ENV = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
] as const;

const OPTIONAL_FIREBASE_ENV = [
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID',
] as const;

export type FirebaseRequiredEnvKey = (typeof REQUIRED_FIREBASE_ENV)[number];
export type FirebaseOptionalEnvKey = (typeof OPTIONAL_FIREBASE_ENV)[number];

export interface FirebaseRuntime {
  enabled: boolean;
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  source: 'env' | 'none';
  missingRequiredEnv: FirebaseRequiredEnvKey[];
  missingOptionalEnv: FirebaseOptionalEnvKey[];
}

let runtime: FirebaseRuntime | null = null;

function env(name: string): string {
  return String((process.env as Record<string, string | undefined>)[name] || '').trim();
}

function resolveFirebaseConfig() {
  const apiKey = env('EXPO_PUBLIC_FIREBASE_API_KEY');
  const authDomain = env('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN');
  const projectId = env('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
  const appId = env('EXPO_PUBLIC_FIREBASE_APP_ID');
  const storageBucket = env('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET');
  const messagingSenderId = env('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');
  const measurementId = env('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID');

  const missingRequiredEnv = REQUIRED_FIREBASE_ENV.filter((key) => !env(key));
  const missingOptionalEnv = OPTIONAL_FIREBASE_ENV.filter((key) => !env(key));

  if (missingRequiredEnv.length > 0) {
    return {
      config: null,
      missingRequiredEnv,
      missingOptionalEnv,
    };
  }

  return {
    config: {
      apiKey,
      authDomain,
      projectId,
      appId,
      storageBucket: storageBucket || undefined,
      messagingSenderId: messagingSenderId || undefined,
      measurementId: measurementId || undefined,
    },
    missingRequiredEnv,
    missingOptionalEnv,
  };
}

function buildFirebaseDisabledErrorMessage(rt: FirebaseRuntime): string {
  if (!rt.missingRequiredEnv.length) {
    return 'Firebase is not available in this environment.';
  }

  return `Firebase not configured. Missing variables: ${rt.missingRequiredEnv.join(', ')}`;
}

function createAuthInstance(app: FirebaseApp): Auth {
  try {
    if (Platform.OS === 'web') {
      return getAuth(app);
    }

    // RN uses platform defaults through initializeAuth when available.
    return initializeAuth(app);
  } catch {
    // Auth ya inicializado en hot-reload o entorno mixto.
    return getAuth(app);
  }
}

export async function initFirebaseRuntime(): Promise<FirebaseRuntime> {
  if (runtime) return runtime;

  const { config, missingRequiredEnv, missingOptionalEnv } = resolveFirebaseConfig();

  if (!config) {
    runtime = {
      enabled: false,
      app: null,
      auth: null,
      db: null,
      source: 'none',
      missingRequiredEnv,
      missingOptionalEnv,
    };

    return runtime;
  }

  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = createAuthInstance(app);
  const db = getFirestore(app);

  runtime = {
    enabled: true,
    app,
    auth,
    db,
    source: 'env',
    missingRequiredEnv,
    missingOptionalEnv,
  };

  return runtime;
}

export async function recheckFirebaseRuntime(): Promise<FirebaseRuntime> {
  runtime = null;
  return initFirebaseRuntime();
}

export async function getFirebaseRuntimeSnapshot(): Promise<FirebaseRuntime> {
  return initFirebaseRuntime();
}

export async function onFirebaseAuthState(cb: (user: User | null) => void) {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) {
    cb(null);
    return () => {};
  }

  return onAuthStateChanged(rt.auth, cb);
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) {
    throw new Error(buildFirebaseDisabledErrorMessage(rt));
  }

  const res = await signInWithEmailAndPassword(rt.auth, email.trim(), password);
  return res.user;
}

export async function registerWithEmail(email: string, password: string): Promise<User> {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) {
    throw new Error(buildFirebaseDisabledErrorMessage(rt));
  }

  const res = await createUserWithEmailAndPassword(rt.auth, email.trim(), password);
  return res.user;
}

export async function sendResetPasswordEmail(email: string): Promise<void> {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) {
    throw new Error(buildFirebaseDisabledErrorMessage(rt));
  }

  await sendPasswordResetEmail(rt.auth, email.trim());
}

export async function logoutFirebase(): Promise<void> {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth) return;

  await signOut(rt.auth);
}

export async function syncScansWithFirebase(local: ScanRecord[]) {
  const rt = await initFirebaseRuntime();
  if (!rt.enabled || !rt.auth || !rt.db) {
    throw new Error(buildFirebaseDisabledErrorMessage(rt));
  }

  const user = rt.auth.currentUser;
  if (!user) throw new Error('No authenticated session to sync.');

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
