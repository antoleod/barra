import { User } from 'firebase/auth';

import { diag } from '../core/diagnostics';
import {
  getFirebaseRuntimeSnapshot,
  loginWithEmail,
  logoutFirebase,
  registerWithEmail,
  sendResetPasswordEmail,
} from '../core/firebase';

import { FirebaseGuardState } from './authTypes';

function readFirebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code?: string }).code || '');
  }

  return '';
}

function readFirebaseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'No fue posible completar la autenticacion.';
}

export function toFriendlyAuthError(error: unknown): string {
  const code = readFirebaseErrorCode(error);
  const map: Record<string, string> = {
    'auth/invalid-email': 'El email no tiene un formato valido.',
    'auth/user-not-found': 'No existe una cuenta con ese email.',
    'auth/wrong-password': 'La contrasena no es correcta.',
    'auth/invalid-credential': 'Credenciales invalidas. Verifica email y contrasena.',
    'auth/email-already-in-use': 'Este email ya esta registrado.',
    'auth/weak-password': 'La contrasena debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta nuevamente en unos minutos.',
    'auth/network-request-failed': 'Error de red. Revisa tu conexion e intenta otra vez.',
    'auth/missing-password': 'Debes ingresar una contrasena.',
  };

  if (code && map[code]) {
    return map[code];
  }

  const message = readFirebaseErrorMessage(error);
  if (message.toLowerCase().includes('firebase no configurado')) {
    return message;
  }

  return 'No fue posible autenticarte. Intenta nuevamente.';
}

export async function getFirebaseGuardState(): Promise<FirebaseGuardState> {
  const runtime = await getFirebaseRuntimeSnapshot();

  if (runtime.enabled) {
    const optionalMessage = runtime.missingOptionalEnv.length
      ? `Opcionales sin definir: ${runtime.missingOptionalEnv.join(', ')}`
      : 'Firebase configurado correctamente.';

    return {
      enabled: true,
      message: optionalMessage,
      missingRequiredEnv: runtime.missingRequiredEnv,
      missingOptionalEnv: runtime.missingOptionalEnv,
    };
  }

  const missing = runtime.missingRequiredEnv.join(', ');

  return {
    enabled: false,
    message: missing
      ? `Firebase no configurado. Variables faltantes: ${missing}`
      : 'Firebase no esta disponible en este entorno.',
    missingRequiredEnv: runtime.missingRequiredEnv,
    missingOptionalEnv: runtime.missingOptionalEnv,
  };
}

export async function login(email: string, password: string): Promise<User> {
  try {
    return await loginWithEmail(email, password);
  } catch (error) {
    const friendly = toFriendlyAuthError(error);
    await diag.warn('auth.login.error', { reason: friendly });
    throw new Error(friendly);
  }
}

export async function register(email: string, password: string): Promise<User> {
  try {
    return await registerWithEmail(email, password);
  } catch (error) {
    const friendly = toFriendlyAuthError(error);
    await diag.warn('auth.register.error', { reason: friendly });
    throw new Error(friendly);
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  try {
    await sendResetPasswordEmail(email);
  } catch (error) {
    const friendly = toFriendlyAuthError(error);
    await diag.warn('auth.reset.error', { reason: friendly });
    throw new Error(friendly);
  }
}

export async function logout(): Promise<void> {
  try {
    await logoutFirebase();
  } catch (error) {
    const friendly = toFriendlyAuthError(error);
    await diag.warn('auth.logout.error', { reason: friendly });
    throw new Error(friendly);
  }
}
