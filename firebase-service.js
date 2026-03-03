import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    getAdditionalUserInfo,
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

const FAKE_DOMAIN = "@barrascanner.local";
const ENV_ERROR =
    "Firebase is not available in this environment. Use 'firebase serve' (http://localhost:5000) or Firebase Hosting.";

async function tryGetJson(url) {
    try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return null;
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function loadFirebaseConfig() {
    const hostingConfig = await tryGetJson("/__/firebase/init.json");
    if (hostingConfig) return hostingConfig;

    // --- CONFIGURACIÓN MANUAL DE RESPALDO ---
    // Rellena esto con los datos de tu proyecto desde la consola de Firebase
    // (Project Settings > General > Your apps > Web app > SDK setup and configuration)
    return {
        apiKey: "AIzaSyBIwE2kuScBVJBK1aTSFo8IlM2HyjVasLc",
        authDomain: "lectorqr-45291.firebaseapp.com",
        projectId: "lectorqr-45291",
        storageBucket: "lectorqr-45291.appspot.com",
        messagingSenderId: "751229393866",
        appId: "1:751229393866:web:1cce5fa16380435ca94d33",
        measurementId: "G-BE9R1XH54E"
    };
}

async function createFirebaseRuntime() {
    const firebaseConfig = await loadFirebaseConfig();
    if (!firebaseConfig) {
        console.warn("[firebase-service]", ENV_ERROR);
        return { app: null, auth: null, db: null, enabled: false };
    }

    // Verificación de seguridad: Detectar si se usan las credenciales de ejemplo
    if (firebaseConfig.apiKey === "TU_API_KEY_AQUI") {
        console.error("[firebase-service] MISSING CONFIGURATION: Replace values in 'firebase-service.js' with your Firebase project's.");
        return { app: null, auth: null, db: null, enabled: false };
    }

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    return { app, auth, db, enabled: true };
}

const runtime = await createFirebaseRuntime();

function unavailableResult() {
    return { success: false, error: ENV_ERROR };
}

export const fbService = {
    auth: runtime.auth,
    db: runtime.db,
    enabled: runtime.enabled,
    currentUser: null,

    init(onUserChange) {
        if (!runtime.enabled) {
            this.currentUser = null;
            onUserChange(null);
            return;
        }
        onAuthStateChanged(runtime.auth, (user) => {
            this.currentUser = user;
            onUserChange(user);
        });
    },

    /**
     * Returns a Promise that resolves with the initial user authentication state.
     * This is crucial for implementing a route guard that waits for auth to be resolved.
     */
    getInitialUser() {
        return new Promise((resolve, reject) => {
            if (!this.enabled) {
                return resolve(null);
            }
            
            // Failsafe: If auth takes too long (e.g. offline/404), resolve null to unblock UI.
            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    console.warn("[firebase-service] Auth check timed out, proceeding as guest/offline.");
                    resolve(null);
                }
            }, 3000);

            // onAuthStateChanged fires immediately with the current state.
            // We only want the first result for our initial guard check.
            const unsubscribe = onAuthStateChanged(this.auth, user => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                unsubscribe(); // Stop listening after the first result
                this.currentUser = user;
                resolve(user);
            }, err => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                unsubscribe();
                reject(err);
            });
        });
    },

    async createUserProfile(user) {
        if (!runtime.enabled || !user) return;
        const userRef = doc(runtime.db, "users", user.uid);
        const displayName = user.displayName || user.email.split("@")[0];
        const profileData = {
            uid: user.uid,
            email: user.email,
            displayName,
            photoURL: user.photoURL,
            createdAt: serverTimestamp(),
        };
        try {
            await setDoc(userRef, profileData);
        } catch (error) {
            console.error("Error creating user profile:", error);
        }
    },

    async loginGoogle() {
        if (!runtime.enabled) return unavailableResult();
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(runtime.auth, provider);
            const additionalInfo = getAdditionalUserInfo(result);
            if (additionalInfo?.isNewUser) {
                await this.createUserProfile(result.user);
            }
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async loginPin(username, pin) {
        if (!runtime.enabled) return unavailableResult();
        const sanitizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!sanitizedUsername) {
            return { success: false, error: "Invalid username." };
        }

        const email = `${sanitizedUsername}${FAKE_DOMAIN}`;
        const password = pin.toString().padEnd(6, "0");

        try {
            const result = await signInWithEmailAndPassword(runtime.auth, email, password);
            return { success: true, user: result.user };
        } catch (error) {
            const createAccountCodes = [
                "auth/invalid-credential",
                "auth/user-not-found",
                "auth/wrong-password",
                "auth/invalid-login-credentials",
            ];

            if (createAccountCodes.includes(error.code)) {
                try {
                    const newResult = await createUserWithEmailAndPassword(runtime.auth, email, password);
                    await this.createUserProfile(newResult.user);
                    return { success: true, user: newResult.user, isNew: true };
                } catch (createError) {
                    if (createError.code === "auth/email-already-in-use") {
                        return { success: false, error: "Incorrect PIN." };
                    }
                    return { success: false, error: "Could not create account." };
                }
            }
            return { success: false, error: `Authentication error: ${error.code}` };
        }
    },

    async logout() {
        if (!runtime.enabled) return;
        await signOut(runtime.auth);
    },

    async syncScans(localPendingScans) {
        if (!runtime.enabled) throw new Error(ENV_ERROR);
        if (!this.currentUser) throw new Error("Not authenticated");

        const uid = this.currentUser.uid;
        const userScansRef = collection(runtime.db, "users", uid, "scans");
        let pushedCount = 0;
        const errors = [];

        for (const scan of localPendingScans) {
            try {
                const docId = scan.date ? new Date(scan.date).getTime().toString() : Date.now().toString();
                await setDoc(
                    doc(userScansRef, docId),
                    {
                        ...scan,
                        syncedAt: Timestamp.now(),
                        uid,
                    },
                    { merge: true }
                );
                pushedCount++;
            } catch (error) {
                console.error("Error uploading scan", scan, error);
                errors.push({ scan, error });
            }
        }

        // Si todos los intentos de subida fallaron, es un error grave que hay que reportar.
        if (errors.length > 0 && errors.length === localPendingScans.length) {
            const firstErrorCode = errors[0].error.code;
            if (firstErrorCode === 'permission-denied') {
                throw new Error("Permission error. Check Firestore security rules.");
            }
            throw new Error(`Upload failed for ${errors.length} records.`);
        }

        const q = query(userScansRef);
        const querySnapshot = await getDocs(q);
        const serverScans = [];
        querySnapshot.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            if (data.syncedAt && data.syncedAt.toDate) {
                delete data.syncedAt;
            }
            serverScans.push(data);
        });

        return { pushedCount, serverScans };
    },

    getUserDisplay() {
        if (!this.currentUser) return "";
        if (this.currentUser.email.endsWith(FAKE_DOMAIN)) {
            return this.currentUser.email.replace(FAKE_DOMAIN, "").toUpperCase();
        }
        return this.currentUser.displayName || this.currentUser.email;
    },
};
