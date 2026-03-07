import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import ForgotPasswordForm from './ForgotPasswordForm';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import { AuthView } from './authTypes';
import { useAuth } from './useAuth';

function FirebaseGuardCard() {
  const { firebase } = useAuth();

  if (firebase.enabled) {
    if (!firebase.missingOptionalEnv.length) {
      return null;
    }

    return (
      <View style={[styles.guardCard, styles.guardOptional]}>
        <Text style={styles.guardTitle}>Firebase configured</Text>
        <Text style={styles.guardText}>{firebase.message}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.guardCard, styles.guardError]}>
      <Text style={styles.guardTitle}>Firebase not configured</Text>
      <Text style={styles.guardText}>{firebase.message}</Text>
      <Text style={styles.guardHint}>Account access is disabled until these variables are defined.</Text>
    </View>
  );
}

export default function AuthScreen() {
  const { enterAsGuest } = useAuth();
  const [view, setView] = useState<AuthView>('login');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <View style={styles.brandArea}>
          <View style={styles.logoShell}>
            <Text style={styles.logoText}>B</Text>
          </View>
          <Text style={styles.title}>Barra Scanner</Text>
          <Text style={styles.subtitle}>
            {view === 'login' && 'Log in to use cloud sync.'}
            {view === 'register' && 'Create a Firebase Auth account.'}
            {view === 'forgot' && 'Recover your password via email.'}
          </Text>
        </View>

        <FirebaseGuardCard />

        <View style={styles.card}>
          {view === 'login' ? (
            <LoginForm
              onSwitchToRegister={() => setView('register')}
              onSwitchToForgot={() => setView('forgot')}
            />
          ) : null}

          {view === 'register' ? (
            <RegisterForm onSwitchToLogin={() => setView('login')} />
          ) : null}

          {view === 'forgot' ? (
            <ForgotPasswordForm onSwitchToLogin={() => setView('login')} />
          ) : null}
        </View>

        <View style={styles.guestBlock}>
          <Text style={styles.guestText}>or continue without an account to use local storage only</Text>
          <Pressable onPress={enterAsGuest} style={styles.guestButton}>
            <Text style={styles.guestButtonText}>Continue as guest</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7fb',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  brandArea: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logoShell: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f82f8',
    marginBottom: 12,
  },
  logoText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
  },
  title: {
    color: '#0f172a',
    fontSize: 23,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    color: '#475569',
    fontSize: 14,
    textAlign: 'center',
  },
  guardCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  guardError: {
    backgroundColor: '#fff7ed',
    borderColor: '#fb923c',
  },
  guardOptional: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  guardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  guardText: {
    fontSize: 13,
    color: '#334155',
  },
  guardHint: {
    fontSize: 12,
    color: '#92400e',
    marginTop: 6,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5ef',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 4,
  },
  guestBlock: {
    marginTop: 18,
    alignItems: 'center',
  },
  guestText: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  guestButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#ffffff',
  },
  guestButtonText: {
    color: '#1e293b',
    fontWeight: '700',
    fontSize: 13,
  },
});
