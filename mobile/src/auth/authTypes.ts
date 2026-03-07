import { User } from 'firebase/auth';

import { FirebaseOptionalEnvKey, FirebaseRequiredEnvKey } from '../core/firebase';

export type AuthView = 'login' | 'register' | 'forgot';

export interface FirebaseGuardState {
  enabled: boolean;
  message: string;
  missingRequiredEnv: FirebaseRequiredEnvKey[];
  missingOptionalEnv: FirebaseOptionalEnvKey[];
}

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isGuest: boolean;
  firebase: FirebaseGuardState;
  enterAsGuest: () => void;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string) => Promise<User>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}
