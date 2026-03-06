import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, Camera, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { AppSettings, AuthStatus, BootStatus, PersistenceMode, ScanRecord, TemplateRule } from './src/types';
import { defaultSettings, loadSettings, piLogic, saveSettings } from './src/core/settings';
import { classify } from './src/core/classify';
import { extractFields } from './src/core/extract';
import { addHistory, clearHistory, loadHistory, saveHistory } from './src/core/history';
import { loadTemplates, saveTemplate } from './src/core/templates';
import { diag } from './src/core/diagnostics';
import { themes, ThemeName } from './src/theme/theme';

type Tab = 'scan' | 'history' | 'settings';

export default function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>('booting');
  const [authStatus, setAuthStatus] = useState<AuthStatus>('guest');
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>('local');
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [templates, setTemplates] = useState<TemplateRule[]>([]);
  const [query, setQuery] = useState('');
  const [lastScanAt, setLastScanAt] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const palette = useMemo(() => {
    const base = themes[(settings.theme || 'dark') as ThemeName] || themes.dark;
    return { ...base, accent: settings.customAccent || base.accent };
  }, [settings]);

  useEffect(() => {
    (async () => {
      try {
        const [loadedSettings, loadedHistory, loadedTemplates] = await Promise.all([
          loadSettings(),
          loadHistory(),
          loadTemplates(),
        ]);
        setSettings(loadedSettings);
        setHistory(loadedHistory);
        setTemplates(loadedTemplates);
        setPersistenceMode('local');
        setAuthStatus('guest');
        await diag.info('boot.ready', { mode: 'local' });
        setBootStatus('ready');
      } catch (error) {
        await diag.error('boot.error', { message: String(error) });
        setBootStatus('error');
      }
    })();
  }, []);

  async function patchSettings(next: Partial<AppSettings>) {
    const merged = { ...settings, ...next };
    setSettings(merged);
    await saveSettings(merged);
  }

  function classifyAndNormalize(raw: string) {
    if (settings.autoDetect || settings.scanProfile === 'auto') return classify(raw, settings);
    if (settings.scanProfile === 'pi_full') {
      const normalized = piLogic.convert(raw, 'FULL', settings) || piLogic.normalize(raw, settings);
      return { profileId: 'pi_full', type: 'PI' as const, normalized, piMode: 'FULL' as const };
    }
    if (settings.scanProfile === 'pi_short') {
      const normalized = piLogic.convert(raw, 'SHORT', settings) || piLogic.normalize(raw, settings);
      return { profileId: 'pi_short', type: 'PI' as const, normalized, piMode: 'SHORT' as const };
    }
    return classify(raw, settings);
  }

  async function persistScan(raw: string, source: ScanRecord['source']) {
    const now = Date.now();
    if (now - lastScanAt < 1000) return;
    setLastScanAt(now);

    const classified = classifyAndNormalize(raw);
    if (!classified.normalized) return;

    if (classified.type === 'PI' && !piLogic.validate(classified.normalized, classified.piMode === 'SHORT' ? 'SHORT' : 'FULL', settings)) {
      Alert.alert('Formato invalido', 'No pasa validacion PI.');
      return;
    }

    if (history.some((x) => x.codeNormalized === classified.normalized && x.type === classified.type)) {
      Alert.alert('Duplicado', classified.normalized);
      return;
    }

    const fields = extractFields(raw, templates);
    const record: ScanRecord = {
      id: `scan_${Date.now()}`,
      codeOriginal: raw,
      codeNormalized: classified.normalized,
      type: classified.type,
      profileId: classified.profileId,
      piMode: classified.piMode,
      source,
      structuredFields: fields,
      date: new Date().toISOString(),
      status: 'pending',
      used: false,
      dateUsed: null,
    };

    const next = await addHistory(record);
    setHistory(next);
    await diag.info('scan.saved', { type: record.type, source: record.source });
  }

  async function onBarCodeScanned(data: string) {
    await persistScan(data, 'camera');
  }

  async function scanFromImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]?.uri) return;

    try {
      const results = await Camera.scanFromURLAsync(res.assets[0].uri, ['qr', 'code128', 'code39', 'ean13', 'ean8']);
      if (!results.length || !results[0].data) {
        Alert.alert('Sin resultado', 'No se detecto codigo en la imagen.');
        return;
      }
      await persistScan(results[0].data, 'image');
    } catch (error) {
      await diag.warn('image.scan.error', { message: String(error) });
      Alert.alert('Error', 'No se pudo escanear la imagen.');
    }
  }

  async function exportCsv() {
    const header = 'id,code,type,profile,piMode,source,date,status,used,structuredFields';
    const rows = history.map((h) => [h.id, h.codeNormalized, h.type, h.profileId, h.piMode, h.source, h.date, h.status, h.used, JSON.stringify(h.structuredFields)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...rows].join('\n');
    const path = `${FileSystem.cacheDirectory}barra_export_${Date.now()}.csv`;
    await FileSystem.writeAsStringAsync(path, csv);
    await Sharing.shareAsync(path, { mimeType: 'text/csv' });
  }

  async function copyLogs() {
    const text = await diag.getText();
    await Clipboard.setStringAsync(text || 'No logs');
    Alert.alert('Logs', 'Copiados al portapapeles');
  }

  async function exportLogs() {
    const path = `${FileSystem.cacheDirectory}barra_logs_${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(path, await diag.getJson());
    await Sharing.shareAsync(path, { mimeType: 'application/json' });
  }

  async function clearAllHistory() {
    Alert.alert('Confirmar', 'Borrar historial local?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setHistory([]);
          await diag.info('history.cleared');
        },
      },
    ]);
  }

  async function markUsed(id: string) {
    const next = history.map((x) => x.id === id ? { ...x, used: true, dateUsed: new Date().toISOString() } : x);
    setHistory(next);
    await saveHistory(next);
  }

  async function saveTemplateFromItem(item: ScanRecord) {
    const next = await saveTemplate({
      name: `${item.type}-${Date.now()}`,
      type: item.type,
      regexRules: item.type === 'PI'
        ? { ticketNumber: `(${settings.fullPrefix}[A-Z0-9]+)` }
        : { ticketNumber: '(RITM\\d+|REQ\\d+|INC\\d+|SCTASK\\d+)' },
      mappingRules: {},
      samplePayloads: [item.codeOriginal],
    });
    setTemplates(next);
  }

  function filteredHistory() {
    return history.filter((x) =>
      x.codeNormalized.toLowerCase().includes(query.toLowerCase()) ||
      x.type.toLowerCase().includes(query.toLowerCase())
    );
  }

  const statusChip = persistenceMode === 'local' ? 'Local mode' : authStatus === 'authenticated' ? 'Firebase' : 'Guest';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]}> 
      <StatusBar barStyle={palette.bg === '#f6f8fc' ? 'dark-content' : 'light-content'} />

      <View style={[styles.header, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <View>
          <Text style={[styles.title, { color: palette.fg }]}>Barra Scanner RN</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>{statusChip}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: palette.accent + '33', borderColor: palette.accent }]}>
          <Text style={[styles.badgeText, { color: palette.fg }]}>{settings.autoDetect ? 'AUTO' : settings.scanProfile.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.content}>
        {bootStatus !== 'ready' ? (
          <View style={styles.center}><Text style={{ color: palette.fg }}>{bootStatus === 'booting' ? 'Cargando...' : 'Error de arranque'}</Text></View>
        ) : activeTab === 'scan' ? (
          <View style={styles.screen}>
            {!cameraPermission?.granted ? (
              <View style={styles.center}>
                <Text style={{ color: palette.fg, marginBottom: 12 }}>Permiso de camara requerido</Text>
                <Pressable style={[styles.btn, { backgroundColor: palette.accent }]} onPress={() => requestCameraPermission()}>
                  <Text style={styles.btnText}>Permitir camara</Text>
                </Pressable>
              </View>
            ) : (
              <CameraView
                style={[styles.camera, { borderColor: palette.border }]}
                barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
                onBarcodeScanned={(event) => onBarCodeScanned(event.data)}
              />
            )}
            <View style={styles.rowButtons}>
              <Pressable style={[styles.btn, { backgroundColor: palette.card, borderColor: palette.border }]} onPress={scanFromImage}>
                <Text style={[styles.btnText, { color: palette.fg }]}>Image scan</Text>
              </Pressable>
              <Pressable style={[styles.btn, { backgroundColor: palette.card, borderColor: palette.border }]} onPress={() => Alert.alert('NFC', 'NFC no disponible en Expo managed por defecto')}>
                <Text style={[styles.btnText, { color: palette.fg }]}>NFC</Text>
              </Pressable>
            </View>
          </View>
        ) : activeTab === 'history' ? (
          <View style={styles.screen}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar..."
              placeholderTextColor={palette.muted}
              style={[styles.input, { color: palette.fg, borderColor: palette.border, backgroundColor: palette.card }]}
            />
            <FlatList
              data={filteredHistory()}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
                  <Text style={[styles.code, { color: palette.fg }]}>{item.codeNormalized}</Text>
                  <Text style={{ color: palette.muted }}>{item.type} • {new Date(item.date).toLocaleString()}</Text>
                  <Text style={{ color: palette.muted }}>Source: {item.source}</Text>
                  <View style={styles.rowButtons}>
                    {!item.used && (
                      <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={() => markUsed(item.id)}>
                        <Text style={{ color: palette.fg }}>Mark used</Text>
                      </Pressable>
                    )}
                    <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={() => saveTemplateFromItem(item)}>
                      <Text style={{ color: palette.fg }}>Save template</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            />
          </View>
        ) : (
          <View style={styles.screen}>
            <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.fg }]}>Auto Detect</Text>
              <Switch value={settings.autoDetect} onValueChange={(v) => patchSettings({ autoDetect: v, scanProfile: v ? 'auto' : settings.scanProfile })} />
              <Text style={[styles.sectionTitle, { color: palette.fg, marginTop: 12 }]}>Theme</Text>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={() => patchSettings({ theme: 'dark' })}><Text style={{ color: palette.fg }}>Dark</Text></Pressable>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={() => patchSettings({ theme: 'light' })}><Text style={{ color: palette.fg }}>Light</Text></Pressable>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={() => patchSettings({ theme: 'eu_blue' })}><Text style={{ color: palette.fg }}>EU Blue</Text></Pressable>
              </View>
              <TextInput
                value={settings.serviceNowBaseUrl}
                onChangeText={(v) => patchSettings({ serviceNowBaseUrl: v })}
                placeholder="ServiceNow base URL"
                placeholderTextColor={palette.muted}
                style={[styles.input, { color: palette.fg, borderColor: palette.border, backgroundColor: palette.bg }]}
              />
              <TextInput
                value={pasteText}
                onChangeText={setPasteText}
                placeholder="Paste ticket text"
                multiline
                placeholderTextColor={palette.muted}
                style={[styles.input, { color: palette.fg, borderColor: palette.border, backgroundColor: palette.bg, minHeight: 90 }]}
              />
              <View style={styles.rowButtons}>
                <Pressable style={[styles.btn, { backgroundColor: palette.accent }]} onPress={() => persistScan(pasteText, 'paste')}><Text style={styles.btnText}>Process paste</Text></Pressable>
              </View>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={exportCsv}><Text style={{ color: palette.fg }}>Export CSV</Text></Pressable>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={clearAllHistory}><Text style={{ color: palette.fg }}>Clear history</Text></Pressable>
              </View>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={copyLogs}><Text style={{ color: palette.fg }}>Copy logs</Text></Pressable>
                <Pressable style={[styles.smallBtn, { borderColor: palette.border }]} onPress={exportLogs}><Text style={{ color: palette.fg }}>Export logs</Text></Pressable>
              </View>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.footer, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        {(['scan', 'history', 'settings'] as Tab[]).map((tab) => (
          <Pressable key={tab} onPress={() => setActiveTab(tab)} style={styles.footerBtn}>
            <Text style={{ color: activeTab === tab ? palette.accent : palette.muted, fontWeight: '700' }}>{tab.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  content: { flex: 1 },
  screen: { flex: 1, padding: 12, gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  camera: { flex: 1, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  rowButtons: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  btnText: { color: '#fff', fontWeight: '700' },
  smallBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginTop: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  code: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  footer: { borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row' },
  footerBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
});

