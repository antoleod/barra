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
    "Firebase 
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
    if (hostingConfig) {
        console.log("[firebase-service] Configuración de Hosting cargada.");
        try { localStorage.setItem("firebase_config_cache", JSON.stringify(hostingConfig)); } catch (_) {}
        return { ...hostingConfig, _source: 'live' };
    }

    // Si falla la red (offline), intentar cargar la configuración guardada previamente
    try {
        const cached = localStorage.getItem("firebase_config_cache");
        if (cached) return { ...JSON.parse(cached), _source: 'cache' };
    } catch (_) {}

    // --- CONFIGURACIÓN MANUAL DE RESPALDO ---
    // Rellena esto con los datos de tu proyecto desde la consola renucq
      s "751229393866",
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
        console.error("[firebase-service] FALTA CONFIGURACIÓN: Reemplaza los valores en 'firebase-service.js' con los de tu proyecto Firebase.");
        console.warn("Nota: El error 404 de init.json es normal en local. Debes poner tu API Key real arriba para que funcione.");
        return { app: null, auth: null, db: null, enabled: false };
    }

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    return { app, auth, db, enabled: true, configSource: firebaseConfig._source };
}
const runtime = await createFirebaseRuntime();

function unavailableResult() {
    return { success: false, error: ENV_ERROR };
}

export const fbService = {
    auth: runtime.auth,
    db: runtime.db,
    enabled: runtime.enabled,
    configSource: runtime.configSource,
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

    async createUserProfile(user) {
        if (!runtime.enabled || !user) return;
        const userRef = doc(runtime.db, "users", user.uid);
        const displayName = user.displayName || user.email.split("@")[0];
        const profileData = {
            uid: user.uid,
            email: user.email,
            displayName,
            photoURL: user.photoURL,
         n unavailableResult();
    tv

      eurs sh/invalid-login-credentials",
            ];

            if (createAccountCodes.includes(error.code)) {
                try {
                    const newResult = await createUserWithEmailAndPassword(runtime.auth, email, password);
                    await this.createUserProfile(newResult.user);
                    return { success: true, user: newResult.user, isNew: true };
                } catch (createError) {
                    if (createError.code === "auth/email-already-in-use") {
                        return { success: false, error: "El PIN es incorrecto." };
                    }
                    return { success: false, error: "No se pudo crear la cuenta." };
                }
            return { success: false, error: `Error de autenticacion: ${error.code}` };
        }
    },

    async logout() {
        if (!runtime.enabled) return;
        await signOut(runtime.auth);
    },

    async syncScans(localPendingScans) {
        if (!runtime.enabled) throw new Error(ENV_ERROR);
        if (!this.currentUser) throw new Error("No autenticado");

        const uid = this.currentUser.uid;
        const userScansRef = collection(runtime.db, "users", uid, "scans");
        let pushedCount = 0;
        const errors = [];

        for (const scan of localPendingScans) {
            try {
                const docId = scan.date ? new Date(scan.date).getTime().toString() : Date.now().toString();
                await setDoc(
                    doc(userScans
                        ...scan,
                        syncedAt: Timestamp.now(),
                        uid,
                    },
                    { merge: true }
                );
                pushedCount++;
            } catch (error) {
                console.error("Error subiendo scan", scan, error);
                errors.push({ scan, error });
            }
        }

        // Si todos los intentos de subida fallaron, es un error grave que hay que reportar.
        if (errors.length > 0 && errors.length === localPendingScans.length) {
            const firstErrorCode = errors[0].error.code;
            if (firstErrorCode === 'permission-denied') {
                throw new Error("Error de permisos. Revisa las reglas de seguridad de Firestore.");
            }
            throw new Error(`Falló la subida de ${errors.length} registros.`);
        }

        const q = query(userScansRef);
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            if (data.syncedAt && data.syncedAt.toDa
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
