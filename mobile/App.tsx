import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AuthScreen from './src/auth/AuthScreen';
import { AuthProvider } from './src/auth/authContext';
import { useAuth } from './src/auth/useAuth';
import MainAppScreen from './src/screens/MainAppScreen';

function AuthGate() {
  const { user, isGuest, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0f82f8" />
        <Text style={styles.loadingText}>Verifying session...</Text>
      </View>
    );
  }

  if (user || isGuest) {
    return <MainAppScreen />;
  }

  return <AuthScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0f15',
    paddingHorizontal: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#dce3ef',
    fontSize: 14,
    fontWeight: '600',
  },
});
