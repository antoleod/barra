import React, { createContext, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';

import { diag } from '../core/diagnostics';
import { onFirebaseAuthState } from '../core/firebase';

import { getFirebaseGuardState, login, logout, register, sendPasswordReset } from './authService';
import { AuthContextValue, FirebaseGuardState } from './authTypes';

const defaultFirebaseGuard: FirebaseGuardState = {
  enabled: false,
  message: 'Initializing Firebase configuration...',
  missingRequiredEnv: [],
  missingOptionalEnv: [],
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [firebase, setFirebase] = useState<FirebaseGuardState>(defaultFirebaseGuard);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;

    const bootstrap = async () => {
      try {
        const guard = await getFirebaseGuardState();
        if (mounted) {
          setFirebase(guard);
          await diag.info('auth.firebase.guard', {
            enabled: guard.enabled,
            missingRequired: guard.missingRequiredEnv,
            missingOptional: guard.missingOptionalEnv,
          });
        }

        unsubscribe = await onFirebaseAuthState((nextUser) => {
          if (!mounted) return;
          setUser(nextUser);
          if (nextUser) {
            setIsGuest(false);
            void diag.info('auth.state.changed', { authenticated: true, uid: nextUser.uid });
          } else {
            void diag.info('auth.state.changed', { authenticated: false });
          }
          setIsLoading(false);
        });
      } catch (error) {
        await diag.error('auth.bootstrap.error', { message: String(error) });
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const enterAsGuest = () => {
    setIsGuest(true);
    setUser(null);
    void diag.info('auth.guest.enabled');
  };

  const loginWithEmailPassword = async (email: string, password: string) => {
    const authenticatedUser = await login(email, password);
    setIsGuest(false);
    setUser(authenticatedUser);
    await diag.info('auth.login.success', { uid: authenticatedUser.uid });
    return authenticatedUser;
  };

  const registerWithEmailPassword = async (email: string, password: string) => {
    const authenticatedUser = await register(email, password);
    setIsGuest(false);
    setUser(authenticatedUser);
    await diag.info('auth.register.success', { uid: authenticatedUser.uid });
    return authenticatedUser;
  };

  const sendResetPasswordEmail = async (email: string) => {
    await sendPasswordReset(email);
    await diag.info('auth.reset.sent', { email });
  };

  const logoutCurrentUser = async () => {
    await logout();
    setUser(null);
    setIsGuest(false);
    await diag.info('auth.logout.success');
  };

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    isGuest,
    firebase,
    enterAsGuest,
    login: loginWithEmailPassword,
    register: registerWithEmailPassword,
    sendPasswordReset: sendResetPasswordEmail,
    logout: logoutCurrentUser,
  }), [firebase, isGuest, isLoading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
