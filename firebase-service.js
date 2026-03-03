import {
    getApp,
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    getAdditionalUserInfo
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
    where,
    Timestamp,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// La app se inicializa automáticamente con /__/firebase/init.js
const app = getApp();
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const FAKE_DOMAIN = "@barrascanner.local";

export const fbService = {
    auth,
    db,
    currentUser: null,

    init(onUserChange) {
        onAuthStateChanged(auth, (user) => {
            this.currentUser = user;
            onUserChange(user);
        });
    },

    async createUserProfile(user) {
        if (!user) return;
        const userRef = doc(db, "users", user.uid);
        // Para los usuarios con PIN, displayName es nulo. Creamos uno a partir del email.
        const displayName = user.displayName || user.email.split('@')[0];
        const profileData = {
            uid: user.uid,
            email: user.email,
            displayName: displayName,
            photoURL: user.photoURL, // Será nulo para usuarios con PIN, ya lo maneja app.js
            createdAt: serverTimestamp(),
        };
        try {
            // setDoc creará el documento. Lo llamamos solo en la creación.
            await setDoc(userRef, profileData);
        } catch (error) {
            console.error("Error creando el perfil de usuario:", error);
        }
    },

    async loginGoogle() {
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            const additionalInfo = getAdditionalUserInfo(result);
            if (additionalInfo.isNewUser) {
                await this.createUserProfile(result.user);
            }
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async loginPin(username, pin) {
        // Sanitize username to be used as part of an email. Only alphanumeric.
        const sanitizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!sanitizedUsername) {
            return { success: false, error: "Nombre de usuario inválido." };
        }

        const email = `${sanitizedUsername}${FAKE_DOMAIN}`;
        // Firebase Auth requires a password of at least 6 characters.
        const password = pin.toString().padEnd(6, '0');

        try {
            // Attempt to sign in first.
            const result = await signInWithEmailAndPassword(auth, email, password);
            return { success: true, user: result.user };
        } catch (error) {
            console.log("Login error code:", error.code);

            // This error is generic for "user not found" or "wrong password" in newer SDKs.
            // We'll try to create an account, assuming it's a new user.
            const createAccountCodes = [
                'auth/invalid-credential',
                'auth/user-not-found',
                'auth/wrong-password',
                'auth/invalid-login-credentials'
            ];

            if (createAccountCodes.includes(error.code)) {
                try {
                    const newResult = await createUserWithEmailAndPassword(auth, email, password);
                    // If creation is successful, create their profile document.
                    await this.createUserProfile(newResult.user);
                    return { success: true, user: newResult.user, isNew: true };
                } catch (createError) {
                    // If creation fails with 'email-already-in-use', it means the user exists
                    // but provided the wrong PIN during the initial sign-in attempt.
                    if (createError.code === 'auth/email-already-in-use') {
                        return { success: false, error: "El PIN es incorrecto." };
                    }
                    // Handle other potential creation errors (e.g., network issue).
                    return { success: false, error: "No se pudo crear la cuenta." };
                }
            }
            // Handle other potential sign-in errors (e.g., network issue).
            return { success: false, error: "Error de autenticación: " + error.code };
        }
    },

    async logout() {
        await signOut(auth);
    },

    // Sincronización
    async syncScans(localPendingScans) {
        if (!this.currentUser) throw new Error("No autenticado");
        const uid = this.currentUser.uid;
        const userScansRef = collection(db, "users", uid, "scans");

        let pushedCount = 0;

        // 1. PUSH: Subir pendientes
        for (const scan of localPendingScans) {
            try {
                // Usamos el timestamp original como ID o generamos uno si no hay
                const docId = scan.date ? new Date(scan.date).getTime().toString() : Date.now().toString();
                await setDoc(doc(userScansRef, docId), {
                    ...scan,
                    syncedAt: Timestamp.now(),
                    uid: uid // Redundancia útil
                }, { merge: true });
                pushedCount++;
            } catch (e) {
                console.error("Error subiendo scan", scan, e);
            }
        }

        // 2. PULL: Descargar todo (Optimización: en prod real filtraríamos por fecha)
        // Para mantenerlo simple y robusto, traemos todo y dejamos que la app filtre duplicados
        // Firestore cachea esto, así que no es tan costoso en lecturas repetidas
        const q = query(userScansRef);
        const querySnapshot = await getDocs(q);

        const serverScans = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Convertir Timestamp de Firestore a ISO String para compatibilidad con app existente
            if (data.syncedAt && data.syncedAt.toDate) {
                delete data.syncedAt; // No lo necesitamos en local
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
    }
};