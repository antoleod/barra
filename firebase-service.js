import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { diag } from "./diagnostics.js";

const FAKE_DOMAIN = "@barrascanner.local";
const CONFIG_CACHE_KEY = "firebase_config_cache";
const MANUAL_CONFIG_KEY = "firebase_manual_config";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INIT_TIMEOUT_MS = 2000;

const ENV_ERROR = "Firebase is not configured. Local mode is enabled.";

function hasFirebaseKeys(config) {
  if (!config || typeof config !== "object") return false;
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => typeof config[key] === "string" && config[key].trim().length > 0);
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = INIT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      diag.warn("firebase.config.fetch_not_ok", { status: response.status, url });
      return null;
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      diag.warn("firebase.config.invalid_content_type", { contentType });
      return null;
    }
    const json = await response.json();
    return hasFirebaseKeys(json) ? json : null;
  } catch (error) {
    diag.warn("firebase.config.fetch_failed", { message: error?.message || String(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCachedConfig() {
  const parsed = safeJsonParse(localStorage.getItem(CONFIG_CACHE_KEY));
  if (!parsed || !parsed.config || !hasFirebaseKeys(parsed.config)) return null;
  return parsed;
}

function readManualConfig() {
  const manual = safeJsonParse(localStorage.getItem(MANUAL_CONFIG_KEY));
  if (hasFirebaseKeys(manual)) return manual;

  if (hasFirebaseKeys(window?.__FIREBASE_CONFIG__)) {
    return window.__FIREBASE_CONFIG__;
  }

  return null;
}

async function loadFirebaseConfig() {
  const now = Date.now();
  const cached = readCachedConfig();

  if (cached && cached.timestamp && now - cached.timestamp < CACHE_MAX_AGE_MS) {
    diag.info("firebase.config.cache_hit", { ageMs: now - cached.timestamp });
    return { ...cached.config, _source: "cache" };
  }

  const liveConfig = await fetchJsonWithTimeout("/__/firebase/init.json", INIT_TIMEOUT_MS);
  if (liveConfig) {
    diag.info("firebase.config.live_loaded");
    try {
      localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ config: liveConfig, timestamp: now }));
    } catch {
      // best effort only
    }
    return { ...liveConfig, _source: "live" };
  }

  if (cached) {
    diag.info("firebase.config.cache_fallback", { ageMs: now - cached.timestamp });
    return { ...cached.config, _source: "cache" };
  }

  const manualConfig = readManualConfig();
  if (manualConfig) {
    diag.info("firebase.config.manual_loaded");
    try {
      localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ config: manualConfig, timestamp: now }));
    } catch {
      // best effort only
    }
    return { ...manualConfig, _source: "manual" };
  }

  diag.warn("firebase.config.unavailable");
  return null;
}

async function createFirebaseRuntime() {
  const firebaseConfig = await loadFirebaseConfig();

  if (!firebaseConfig) {
    return {
      app: null,
      auth: null,
      db: null,
      enabled: false,
      configSource: "none",
    };
  }

  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });

    return {
      app,
      auth,
      db,
      enabled: true,
      configSource: firebaseConfig._source || "manual",
    };
  } catch (error) {
    diag.error("firebase.runtime.init_failed", { message: error?.message || String(error) });
    return {
      app: null,
      auth: null,
      db: null,
      enabled: false,
      configSource: "none",
    };
  }
}

let runtimePromise = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createFirebaseRuntime();
  }
  return runtimePromise;
}

function toFakeEmail(username) {
  const normalized = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return normalized ? `${normalized}${FAKE_DOMAIN}` : "";
}

function ensurePin(password) {
  return String(password || "").trim();
}

export const fbService = {
  auth: null,
  db: null,
  enabled: false,
  configSource: "none",
  currentUser: null,

  async _ensureReady() {
    const runtime = await getRuntime();
    this.auth = runtime.auth;
    this.db = runtime.db;
    this.enabled = runtime.enabled;
    this.configSource = runtime.configSource;
    return runtime;
  },

  init(onUserChange) {
    this._ensureReady().then((runtime) => {
      if (!runtime.enabled) {
        this.currentUser = null;
        onUserChange(null);
        return;
      }

      onAuthStateChanged(runtime.auth, (user) => {
        this.currentUser = user;
        diag.info("auth.state_changed", { user: user?.uid || null });
        onUserChange(user);
      });
    });
  },

  async getInitialUser(timeoutMs = 1500) {
    const runtime = await this._ensureReady();
    if (!runtime.enabled) {
      return null;
    }

    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(runtime.auth.currentUser || null);
        }
      }, timeoutMs);

      const unsubscribe = onAuthStateChanged(runtime.auth, (user) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        this.currentUser = user;
        resolve(user || null);
      });
    });
  },

  async createUserProfile(user) {
    const runtime = await this._ensureReady();
    if (!runtime.enabled || !user) return;

    const userRef = doc(runtime.db, "users", user.uid);
    const displayName = user.displayName || user.email.split("@")[0];
    const profileData = {
      uid: user.uid,
      email: user.email,
      displayName,
      photoURL: user.photoURL || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(userRef, profileData, { merge: true });
  },

  async loginGoogle() {
    const runtime = await this._ensureReady();
    if (!runtime.enabled) {
      return { success: false, error: ENV_ERROR };
    }

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(runtime.auth, provider);
      await this.createUserProfile(result.user);
      return { success: true, user: result.user, isNew: false };
    } catch (error) {
      return { success: false, error: error?.code || error?.message || "auth/unknown" };
    }
  },

  async loginPin(username, pin) {
    const runtime = await this._ensureReady();
    if (!runtime.enabled) {
      return { success: false, error: ENV_ERROR };
    }

    const email = toFakeEmail(username);
    const password = ensurePin(pin);

    if (!email || password.length < 4) {
      return { success: false, error: "Username and PIN are required." };
    }

    try {
      const loginResult = await signInWithEmailAndPassword(runtime.auth, email, password);
      await this.createUserProfile(loginResult.user);
      return { success: true, user: loginResult.user, isNew: false };
    } catch (error) {
      if (error?.code === "auth/wrong-password") {
        return { success: false, error: "Incorrect PIN." };
      }

      const createAccountCodes = [
        "auth/user-not-found",
        "auth/invalid-credential",
        "auth/invalid-login-credentials",
      ];

      if (createAccountCodes.includes(error?.code)) {
        try {
          const newResult = await createUserWithEmailAndPassword(runtime.auth, email, password);
          await this.createUserProfile(newResult.user);
          return { success: true, user: newResult.user, isNew: true };
        } catch (createError) {
          if (createError?.code === "auth/email-already-in-use") {
            return { success: false, error: "Incorrect PIN." };
          }
          return { success: false, error: "Could not create account." };
        }
      }

      return { success: false, error: `Authentication error: ${error?.code || "unknown"}` };
    }
  },

  async logout() {
    const runtime = await this._ensureReady();
    if (!runtime.enabled) return;
    await signOut(runtime.auth);
  },

  async syncScans(localPendingScans) {
    const runtime = await this._ensureReady();
    if (!runtime.enabled) throw new Error(ENV_ERROR);
    if (!this.currentUser) throw new Error("Not authenticated");

    const uid = this.currentUser.uid;
    const userScansRef = collection(runtime.db, "users", uid, "scans");
    let pushedCount = 0;
    const errors = [];

    for (const scan of localPendingScans) {
      const time = scan.date ? new Date(scan.date).getTime() : Date.now();
      const rawId = `${scan.profileId || "legacy"}_${scan.code_normalized || "unknown"}_${time}`;
      const docId = rawId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);

      try {
        await setDoc(
          doc(userScansRef, docId),
          {
            ...scan,
            uid,
            syncedAt: Timestamp.now(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        pushedCount += 1;
      } catch (error) {
        errors.push({ scan, error });
      }
    }

    if (errors.length > 0 && errors.length === localPendingScans.length) {
      const firstCode = errors[0].error?.code;
      if (firstCode === "permission-denied") {
        throw new Error("Firestore permission denied. Check rules.");
      }
      throw new Error(`Failed to upload ${errors.length} records.`);
    }

    const querySnapshot = await getDocs(query(userScansRef));
    const serverScans = [];

    querySnapshot.forEach((snapshotDoc) => {
      const data = snapshotDoc.data();
      if (data.syncedAt?.toDate) {
        data.syncedAt = data.syncedAt.toDate().toISOString();
      }
      if (data.updatedAt?.toDate) {
        data.updatedAt = data.updatedAt.toDate().toISOString();
      }
      serverScans.push(data);
    });

    return { pushedCount, serverScans };
  },

  getUserDisplay() {
    if (!this.currentUser) return "";
    const email = this.currentUser.email || "";
    if (email.endsWith(FAKE_DOMAIN)) {
      return email.replace(FAKE_DOMAIN, "").toUpperCase();
    }
    return this.currentUser.displayName || email;
  },
};
