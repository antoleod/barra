import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/useAuth';
import { themes } from '../theme/theme';
import { syncScansWithFirebase } from '../core/firebase';
import { loadHistory, ScanRecord } from '../core/history';

// Aquí irían tus componentes reales de Scanner, History y Settings.
// Por ahora, haremos una estructura básica para probar que la navegación y el Auth funcionan.

type Tab = 'scan' | 'history' | 'settings';

export default function MainAppScreen() {
  const { user, isGuest, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [syncing, setSyncing] = useState(false);
  const [localHistory, setLocalHistory] = useState<ScanRecord[]>([]);

  // Cargar tema (puedes conectar esto con tu settings.ts real)
  const palette = themes.dark;

  useEffect(() => {
    loadHistory().then(setLocalHistory);
  }, []);

  const handleSync = async () => {
    if (isGuest || !user) {
      Alert.alert('Modo Invitado', 'Debes iniciar sesión para sincronizar.');
      return;
    }
    setSyncing(true);
    try {
      const result = await syncScansWithFirebase(localHistory);
      Alert.alert('Sincronización', `Enviados: ${result.pushed}. Total en nube: ${result.server.length}`);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSyncing(false);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'scan':
        return (
          <View style={styles.centerContent}>
            <Ionicons name="qr-code-outline" size={80} color={palette.accent} />
            <Text style={[styles.text, { color: palette.fg }]}>Pantalla de Escáner</Text>
            <Text style={{ color: palette.muted, marginTop: 10 }}>Aquí iría la cámara</Text>
          </View>
        );
      case 'history':
        return (
          <View style={styles.centerContent}>
            <Ionicons name="list-outline" size={80} color={palette.accent} />
            <Text style={[styles.text, { color: palette.fg }]}>Historial</Text>
            <Text style={{ color: palette.muted }}>{localHistory.length} registros locales</Text>
          </View>
        );
      case 'settings':
        return (
          <View style={styles.centerContent}>
            <Ionicons name="settings-outline" size={80} color={palette.accent} />
            <Text style={[styles.text, { color: palette.fg, marginBottom: 20 }]}>Configuración</Text>
            
            <View style={styles.infoBox}>
              <Text style={{ color: palette.muted }}>Usuario:</Text>
              <Text style={{ color: palette.fg, fontWeight: 'bold' }}>
                {isGuest ? 'Invitado (Local)' : user?.email}
              </Text>
            </View>

            {!isGuest && (
              <Pressable 
                style={[styles.btn, { backgroundColor: palette.accent, marginBottom: 10 }]} 
                onPress={handleSync}
                disabled={syncing}
              >
                {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sincronizar Ahora</Text>}
              </Pressable>
            )}

            <Pressable style={[styles.btn, { backgroundColor: '#ef4444' }]} onPress={logout}>
              <Text style={styles.btnText}>Cerrar Sesión / Salir</Text>
            </Pressable>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.contentArea}>
        {renderContent()}
      </View>

      {/* Tab Bar Inferior */}
      <View style={[styles.tabBar, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Pressable style={styles.tabItem} onPress={() => setActiveTab('scan')}>
          <Ionicons name="scan" size={24} color={activeTab === 'scan' ? palette.accent : palette.muted} />
          <Text style={{ color: activeTab === 'scan' ? palette.accent : palette.muted, fontSize: 10 }}>Scan</Text>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => setActiveTab('history')}>
          <Ionicons name="time" size={24} color={activeTab === 'history' ? palette.accent : palette.muted} />
          <Text style={{ color: activeTab === 'history' ? palette.accent : palette.muted, fontSize: 10 }}>History</Text>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => setActiveTab('settings')}>
          <Ionicons name="options" size={24} color={activeTab === 'settings' ? palette.accent : palette.muted} />
          <Text style={{ color: activeTab === 'settings' ? palette.accent : palette.muted, fontSize: 10 }}>Settings</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentArea: { flex: 1, justifyContent: 'center' },
  centerContent: { alignItems: 'center', padding: 20 },
  text: { fontSize: 18, fontWeight: 'bold' },
  tabBar: {
    flexDirection: 'row',
    height: 60,
    borderTopWidth: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: { alignItems: 'center', justifyContent: 'center', padding: 5 },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600' },
  infoBox: {
    marginBottom: 30,
    alignItems: 'center',
    padding: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    width: '100%',
  }
});