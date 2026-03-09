﻿import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, Camera, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';

import { AppSettings, BootStatus, PersistenceMode, ScanRecord, TemplateRule } from '../types';
import { defaultSettings, loadSettings, piLogic, saveSettings } from '../core/settings';
import { classify } from '../core/classify';
import { extractFields } from '../core/extract';
import { addHistory, clearHistory, loadHistory, saveHistory } from '../core/history';
import { loadTemplates, saveTemplate } from '../core/templates';
import { diag } from '../core/diagnostics';
import { themes, ThemeName } from '../theme/theme';
import {
  initFirebaseRuntime,
  recheckFirebaseRuntime,
  syncScansWithFirebase,
} from '../core/firebase';
import { useAuth } from '../auth/useAuth';
import QRCode from 'react-native-qrcode-svg';

type Tab = 'scan' | 'history' | 'settings';

function LogoMark({ accent, foreground, compact }: { accent: string; foreground: string; compact?: boolean }) {
  const size = compact ? 44 : 52;
  const lineHeight = compact ? 18 : 22;
  return (
    <View style={[styles.logoShell, { width: size, height: size, borderColor: accent }]}>
      <View style={[styles.logoHalo, { backgroundColor: accent + '22' }]} />
      <View style={[styles.logoCore, { backgroundColor: accent }]}>
        <View style={styles.logoBars}>
          <View style={[styles.logoBar, { height: lineHeight, backgroundColor: foreground }]} />
          <View style={[styles.logoBarThin, { height: lineHeight - 4, backgroundColor: foreground }]} />
          <View style={[styles.logoBar, { height: lineHeight + 2, backgroundColor: foreground }]} />
          <View style={[styles.logoBarThin, { height: lineHeight - 2, backgroundColor: foreground }]} />
        </View>
      </View>
    </View>
  );
}

class SimpleErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    diag.error('ui.error', { message: String(error) });
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={[styles.safe, styles.center]}>
          <Text style={{ fontWeight: '800', marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ textAlign: 'center', paddingHorizontal: 16 }}>{String(this.state.error.message)}</Text>
          <Pressable
            style={[styles.btn, { marginTop: 12, backgroundColor: '#0f82f8' }]}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={styles.btnText}>Retry</Text>
          </Pressable>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const { user, isGuest, logout } = useAuth();
  const { height, width } = useWindowDimensions();
  const [bootStatus, setBootStatus] = useState<BootStatus>('booting');
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>('local');
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [templates, setTemplates] = useState<TemplateRule[]>([]);
  const [query, setQuery] = useState('');
  const [lastScanAt, setLastScanAt] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [qrData, setQrData] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  const scanBusyRef = useRef(false);
  const lastPayloadRef = useRef<{ value: string; ts: number }>({ value: '', ts: 0 });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const isCompactLayout = width < 390 || height < 780;

  const palette = useMemo(() => {
    const base = themes[(settings.theme || 'dark') as ThemeName] || themes.dark;
    return { ...base, accent: settings.customAccent || base.accent };
  }, [settings]);

  useEffect(() => {
    (async () => {
      const timeoutMs = 6000;
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('boot-timeout')), timeoutMs));
      try {
        const [loadedSettings, loadedHistory, loadedTemplates] = await Promise.race([
          Promise.all([loadSettings(), loadHistory(), loadTemplates()]),
          timeout,
        ]);
        setSettings(loadedSettings || defaultSettings);
        setHistory(loadedHistory || []);
        setTemplates(loadedTemplates || []);

        const rt = await Promise.race([initFirebaseRuntime(), timeout]);
        setPersistenceMode(rt.enabled ? 'firebase' : 'local');

        await diag.info('boot.ready', { mode: rt.enabled ? 'firebase' : 'local' });
        setBootStatus('ready');
      } catch (error) {
        await diag.error('boot.error', { message: String(error) });
        // En móviles lentos preferimos levantar en modo local aun si falla boot.
        setSettings(defaultSettings);
        setHistory([]);
        setTemplates([]);
        setPersistenceMode('local');
        setBootStatus('ready');
      }
    })();
  }, []);

  async function patchSettings(next: Partial<AppSettings>) {
    const merged = { ...settings, ...next };
    setSettings(merged);
    await saveSettings(merged);
  }

  function toggleSelection(id: string) {
    const next = new Set(selection);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelection(next);
  }

  function handleLongPress(id: string) {
    if (selection.size === 0) {
      toggleSelection(id);
    }
  }

  async function handleShare() {
    const itemsToShare = history.filter((item) => selection.has(item.id));
    if (itemsToShare.length === 0) return;

    const dataToShare = JSON.stringify(
      itemsToShare.map((item) => ({ c: item.codeNormalized, t: item.type, d: item.date }))
    );

    Alert.alert(
      'Share Selection',
      `Share ${itemsToShare.length} item(s)`,
      [
        { text: 'Generate QR Code', onPress: () => showQrCode(dataToShare) },
        { text: 'Share as Text', onPress: () => shareAsText(dataToShare) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function shareAsText(text: string) {
    try {
      await Sharing.shareAsync(text);
      setSelection(new Set());
    } catch (error) {
      Alert.alert('Share Error', String(error));
    }
  }

  function showQrCode(data: string) {
    setQrData(data);
    setQrModalVisible(true);
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

  async function playScanSound() {
    try {
      // Ensure you have a beep.mp3 in your assets folder
      const { sound } = await Audio.Sound.createAsync(require('../../assets/beep.mp3'));
      await sound.playAsync();
    } catch (error) {
      // Fail silently if sound file is missing
    }
  }

  async function persistScan(raw: string, source: ScanRecord['source']) {
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;

    try {
      const payload = String(raw || '').trim();
      if (!payload) return;

      const now = Date.now();
      if (lastPayloadRef.current.value === payload && now - lastPayloadRef.current.ts < 1200) return;
      lastPayloadRef.current = { value: payload, ts: now };

      if (now - lastScanAt < 1000) return;
      setLastScanAt(now);
      Vibration.vibrate();
      playScanSound();

      const classified = classifyAndNormalize(payload);
      if (!classified.normalized) return;

      if (classified.type === 'PI' && !piLogic.validate(classified.normalized, classified.piMode === 'SHORT' ? 'SHORT' : 'FULL', settings)) {
        Alert.alert('Invalid format', 'PI validation failed.');
        return;
      }

      if (history.some((x) => x.codeNormalized === classified.normalized && x.type === classified.type)) {
        Alert.alert('Duplicate', classified.normalized);
        return;
      }

      const fields = extractFields(payload, templates);
      const record: ScanRecord = {
        id: `scan_${Date.now()}`,
        codeOriginal: payload,
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
    } finally {
      scanBusyRef.current = false;
    }
  }

  async function handleImportScan(json: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return false;
      // Verificamos que tenga la estructura de exportación: [{ c: 'code', t: 'type', ... }]
      const isImport = parsed.length > 0 && parsed[0].c && parsed[0].t;
      if (!isImport) return false;

      if (scanBusyRef.current) return true;
      scanBusyRef.current = true;

      Alert.alert(
        'Importar Escaneos',
        `El QR contiene ${parsed.length} elementos. ¿Deseas importarlos?`,
        [
          {
            text: 'Cancelar',
            style: 'cancel',
            onPress: () => {
              scanBusyRef.current = false;
              // Evitamos que se vuelva a escanear inmediatamente el mismo QR
              lastPayloadRef.current = { value: json, ts: Date.now() };
            },
          },
          {
            text: 'Importar',
            onPress: async () => {
              try {
                let imported = 0;
                for (const item of parsed) {
                  // Evitamos duplicados exactos
                  if (!history.some((h) => h.codeNormalized === item.c && h.type === item.t)) {
                    const record: ScanRecord = {
                      id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                      codeOriginal: item.c,
                      codeNormalized: item.c,
                      type: item.t,
                      profileId: 'import',
                      piMode: 'N/A',
                      source: 'import',
                      structuredFields: {},
                      date: item.d || new Date().toISOString(),
                      status: 'pending',
                      used: false,
                      dateUsed: null,
                    };
                    await addHistory(record);
                    imported++;
                  }
                }
                const nextHistory = await loadHistory();
                setHistory(nextHistory);
                Alert.alert('Importación Exitosa', `Se importaron ${imported} nuevos elementos.`);
              } catch (e) {
                Alert.alert('Error de Importación', String(e));
              } finally {
                scanBusyRef.current = false;
                lastPayloadRef.current = { value: json, ts: Date.now() };
              }
            },
          },
        ]
      );
      return true;
    } catch {
      return false;
    }
  }

  async function onBarCodeScanned(data: string) {
    // Intentamos detectar si es un QR de importación primero
    if (data.startsWith('[') && (data.includes('"c":') || data.includes('"t":'))) {
      const handled = await handleImportScan(data);
      if (handled) return;
    }
    await persistScan(data, 'camera');
  }

  async function scanFromImage() {
    if (Platform.OS === 'web') {
      Alert.alert('Web', 'Image scanning is not supported on web yet.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]?.uri) return;

    try {
      const results = await Camera.scanFromURLAsync(res.assets[0].uri, ['qr', 'code128', 'code39', 'ean13', 'ean8']);
      if (!results.length || !results[0].data) {
        Alert.alert('No result', 'No code detected in the image.');
        return;
      }
      await persistScan(results[0].data, 'image');
    } catch (error) {
      await diag.warn('image.scan.error', { message: String(error) });
      Alert.alert('Error', 'Could not scan the image.');
    }
  }

  async function exportCsv() {
    const header = 'id,code,type,profile,piMode,source,date,status,used,structuredFields';
    const rows = history.map((h) => [h.id, h.codeNormalized, h.type, h.profileId, h.piMode, h.source, h.date, h.status, h.used, JSON.stringify(h.structuredFields)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...rows].join('\n');

    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `barra_export_${Date.now()}.csv`;
      link.click();
      return;
    }

    const path = `${FileSystem.cacheDirectory}barra_export_${Date.now()}.csv`;
    await FileSystem.writeAsStringAsync(path, csv);
    await Sharing.shareAsync(path, { mimeType: 'text/csv' });
  }

  async function copyLogs() {
    const text = await diag.getText();
    await Clipboard.setStringAsync(text || 'No logs');
    Alert.alert('Logs', 'Copied to clipboard');
  }

  async function exportLogs() {
    if (Platform.OS === 'web') {
      const json = await diag.getJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `barra_logs_${Date.now()}.json`;
      link.click();
      return;
    }

    const path = `${FileSystem.cacheDirectory}barra_logs_${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(path, await diag.getJson());
    await Sharing.shareAsync(path, { mimeType: 'application/json' });
  }

  async function recheckFirebase() {
    try {
      const rt = await recheckFirebaseRuntime();
      setPersistenceMode(rt.enabled ? 'firebase' : 'local');
      Alert.alert('Firebase', rt.enabled ? 'Configuration detected' : 'No configuration, local mode');
    } catch (error) {
      Alert.alert('Firebase', `Error recheck: ${String(error)}`);
    }
  }

  async function syncNow() {
    if (syncBusy || !user) return;

    setSyncBusy(true);
    try {
      const result = await syncScansWithFirebase(history);
      const localKeys = new Set(history.map((x) => `${x.type}::${x.codeNormalized}`));
      const merged = history.map((x) => (x.status === 'pending' ? { ...x, status: 'sent' as const } : x));
      for (const scan of result.server) {
        const key = `${scan.type}::${scan.codeNormalized}`;
        if (!localKeys.has(key)) merged.push(scan);
      }
      setHistory(merged);
      await saveHistory(merged);
      await diag.info('firebase.sync.ok', { pushed: result.pushed, total: merged.length });
      Alert.alert('Sync', `OK. pushed=${result.pushed}, total=${merged.length}`);
    } catch (error) {
      await diag.error('firebase.sync.error', { message: String(error) });
      Alert.alert('Sync error', String(error));
    } finally {
      setSyncBusy(false);
    }
  }

  async function clearAllHistory() {
    Alert.alert('Confirm', 'Clear local history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
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
    return history.filter((x) => {
      const matchesQuery = x.codeNormalized.toLowerCase().includes(query.toLowerCase()) ||
        x.type.toLowerCase().includes(query.toLowerCase());
      const matchesType = filterType === 'ALL' || x.type === filterType;

      let matchesDate = true;
      if (dateFilter !== 'ALL') {
        const date = new Date(x.date);
        const now = new Date();
        if (dateFilter === 'TODAY') {
          matchesDate = date.toDateString() === now.toDateString();
        } else if (dateFilter === 'WEEK') {
          matchesDate = date.getTime() > now.getTime() - 7 * 24 * 60 * 60 * 1000;
        } else if (dateFilter === 'MONTH') {
          matchesDate = date.getTime() > now.getTime() - 30 * 24 * 60 * 60 * 1000;
        }
      }

      return matchesQuery && matchesType && matchesDate;
    });
  }

  const statusChip = persistenceMode === 'local'
    ? isGuest
      ? 'Guest mode (local)'
      : 'Local mode'
    : user
      ? `Firebase (${user.email || 'user'})`
      : 'Firebase guest';

  function tabIcon(tab: Tab, active: boolean) {
    const color = active ? palette.accent : palette.muted;
    if (tab === 'scan') return <Ionicons name="scan" size={18} color={color} />;
    if (tab === 'history') return <Ionicons name="time-outline" size={18} color={color} />;
    return <Ionicons name="settings-outline" size={18} color={color} />;
  }

  const content = (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]}> 
      <StatusBar barStyle={palette.bg === '#f6f8fc' ? 'dark-content' : 'light-content'} />

      <View style={[styles.header, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <View style={styles.brandBlock}>
          <LogoMark accent={palette.accent} foreground={palette.bg === '#f6f8fc' ? '#132033' : '#0f1218'} compact={isCompactLayout} />
          <View>
            <Text style={[styles.kicker, { color: palette.accent }]}>BARRA CORE</Text>
            <Text style={[styles.title, { color: palette.fg }]}>Barra Scanner RN</Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>{statusChip}</Text>
          </View>
        </View>
        <View style={[styles.badge, { backgroundColor: palette.accent + '33', borderColor: palette.accent }]}>
          <Text style={[styles.badgeText, { color: palette.fg }]}>{settings.autoDetect ? 'AUTO' : settings.scanProfile.toUpperCase()}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={isCompactLayout ? 6 : 0}
      >
        {bootStatus !== 'ready' ? (
          <View style={styles.center}><Text style={{ color: palette.fg }}>{bootStatus === 'booting' ? 'Loading...' : 'Boot error'}</Text></View>
        ) : activeTab === 'scan' ? (
          <View style={styles.screen}>
            {!cameraPermission?.granted ? (
              <View style={styles.center}>
                <Text style={{ color: palette.fg, marginBottom: 12 }}>Camera permission required</Text>
                <Pressable style={[styles.btn, styles.actionBtn, { backgroundColor: palette.accent }]} onPress={() => requestCameraPermission()}>
                  <View style={styles.btnContent}>
                    <Ionicons name="camera-outline" size={18} color="#fff" />
                    <Text style={styles.btnText}>Allow camera</Text>
                  </View>
                </Pressable>
              </View>
            ) : (
              <CameraView
                style={[
                  styles.camera,
                  isCompactLayout ? styles.cameraCompact : null,
                  { borderColor: palette.border },
                ]}
                barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
                onBarcodeScanned={(event) => onBarCodeScanned(event.data)}
              />
            )}
            <View style={styles.rowButtons}>
              <Pressable style={[styles.btn, styles.actionBtn, { backgroundColor: palette.card, borderColor: palette.border }]} onPress={scanFromImage}>
                <View style={styles.btnContent}>
                  <Ionicons name="images-outline" size={18} color={palette.fg} />
                  <Text style={[styles.btnText, { color: palette.fg }]}>Image scan</Text>
                </View>
              </Pressable>
              <Pressable style={[styles.btn, styles.actionBtn, { backgroundColor: palette.card, borderColor: palette.border }]} onPress={() => Alert.alert('NFC', 'NFC not available in Expo managed by default')}>
                <View style={styles.btnContent}>
                  <MaterialCommunityIcons name="nfc-variant" size={18} color={palette.fg} />
                  <Text style={[styles.btnText, { color: palette.fg }]}>NFC</Text>
                </View>
              </Pressable>
            </View>
          </View>
        ) : activeTab === 'history' ? (
          <View style={styles.screen}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search..."
              placeholderTextColor={palette.muted}
              style={[styles.input, { color: palette.fg, borderColor: palette.border, backgroundColor: palette.card }]}
            />
            <View style={styles.filterRow}>
              {['ALL', 'PI', 'RITM', 'QR'].map((t) => (
                <Pressable
                  key={t}
                  style={[styles.filterChip, filterType === t ? { backgroundColor: palette.accent } : { borderColor: palette.border, borderWidth: 1 }]}
                  onPress={() => setFilterType(t)}
                >
                  <Text style={{ color: filterType === t ? '#fff' : palette.fg, fontSize: 12, fontWeight: '700' }}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.filterRow}>
              {['ALL', 'TODAY', 'WEEK', 'MONTH'].map((d) => (
                <Pressable
                  key={d}
                  style={[styles.filterChip, dateFilter === d ? { backgroundColor: palette.accent } : { borderColor: palette.border, borderWidth: 1 }]}
                  onPress={() => setDateFilter(d as any)}
                >
                  <Text style={{ color: dateFilter === d ? '#fff' : palette.fg, fontSize: 12, fontWeight: '700' }}>{d}</Text>
                </Pressable>
              ))}
            </View>
            <FlatList
              data={filteredHistory()}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
                  <Text style={{ color: palette.fg }}>No scans yet.</Text>
                </View>
              }
              renderItem={({ item }) => {
                const isSelected = selection.has(item.id);
                return (
                  <Pressable
                    onPress={() => selection.size > 0 && toggleSelection(item.id)}
                    onLongPress={() => handleLongPress(item.id)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                  >
                    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }, isSelected && { borderColor: palette.accent, borderWidth: 2 }]}>
                      <Text style={[styles.code, { color: palette.fg }]}>{item.codeNormalized}</Text>
                      <Text style={{ color: palette.muted }}>{item.type} • {new Date(item.date).toLocaleString()}</Text>
                      <Text style={{ color: palette.muted }}>Source: {item.source}</Text>
                      <View style={styles.rowButtons}>
                        {!item.used && (
                          <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={() => markUsed(item.id)}>
                            <View style={styles.inlineAction}>
                              <Ionicons name="checkmark-done-outline" size={16} color={palette.fg} />
                              <Text style={{ color: palette.fg }}>Mark used</Text>
                            </View>
                          </Pressable>
                        )}
                        <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={() => saveTemplateFromItem(item)}>
                          <View style={styles.inlineAction}>
                            <Ionicons name="bookmark-outline" size={16} color={palette.fg} />
                            <Text style={{ color: palette.fg }}>Save template</Text>
                          </View>
                        </Pressable>
                      </View>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        ) : (
          <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.settingsContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.fg }]}>Auto Detect</Text>
              <Switch value={settings.autoDetect} onValueChange={(v) => patchSettings({ autoDetect: v, scanProfile: v ? 'auto' : settings.scanProfile })} />
              <Text style={[styles.sectionTitle, { color: palette.fg, marginTop: 12 }]}>Theme</Text>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={() => patchSettings({ theme: 'dark' })}><Text style={{ color: palette.fg }}>Dark</Text></Pressable>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={() => patchSettings({ theme: 'light' })}><Text style={{ color: palette.fg }}>Light</Text></Pressable>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={() => patchSettings({ theme: 'eu_blue' })}><Text style={{ color: palette.fg }}>EU Blue</Text></Pressable>
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
                textAlignVertical="top"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.pasteInput, { color: palette.fg, borderColor: palette.border, backgroundColor: palette.bg }]}
              />
              <View style={styles.rowButtons}>
                <Pressable style={[styles.btn, styles.actionBtn, { backgroundColor: palette.accent }]} onPress={() => persistScan(pasteText, 'paste')}>
                  <View style={styles.btnContent}>
                    <Ionicons name="sparkles-outline" size={18} color="#fff" />
                    <Text style={styles.btnText}>Process paste</Text>
                  </View>
                </Pressable>
              </View>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={exportCsv}>
                  <View style={styles.inlineAction}>
                    <Ionicons name="download-outline" size={16} color={palette.fg} />
                    <Text style={{ color: palette.fg }}>Export CSV</Text>
                  </View>
                </Pressable>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={clearAllHistory}>
                  <View style={styles.inlineAction}>
                    <Ionicons name="trash-outline" size={16} color={palette.fg} />
                    <Text style={{ color: palette.fg }}>Clear history</Text>
                  </View>
                </Pressable>
              </View>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={copyLogs}>
                  <View style={styles.inlineAction}>
                    <Ionicons name="copy-outline" size={16} color={palette.fg} />
                    <Text style={{ color: palette.fg }}>Copy logs</Text>
                  </View>
                </Pressable>
                <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={exportLogs}>
                  <View style={styles.inlineAction}>
                    <Ionicons name="document-text-outline" size={16} color={palette.fg} />
                    <Text style={{ color: palette.fg }}>Export logs</Text>
                  </View>
                </Pressable>
              </View>

              <Text style={[styles.sectionTitle, { color: palette.fg, marginTop: 12 }]}>Account</Text>
              <View style={[styles.card, { backgroundColor: palette.bg, borderColor: palette.border, marginTop: 8 }]}>
                <Text style={{ color: palette.fg, fontWeight: '700' }}>{user ? user.email : 'Guest User'}</Text>
                <Text style={{ color: palette.muted, fontSize: 12, marginBottom: 12 }}>
                  {user ? `UID: ${user.uid.substring(0, 8)}...` : 'Local storage only'}
                </Text>
                
                <View style={styles.rowButtons}>
                  <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={recheckFirebase}>
                    <View style={styles.inlineAction}>
                      <Ionicons name="refresh-outline" size={16} color={palette.fg} />
                      <Text style={{ color: palette.fg }}>Recheck Firebase</Text>
                    </View>
                  </Pressable>
                  {user && (
                    <Pressable
                      style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border, opacity: syncBusy ? 0.5 : 1 }]}
                      disabled={syncBusy}
                      onPress={syncNow}
                    >
                      <View style={styles.inlineAction}>
                        <Ionicons name="cloud-upload-outline" size={16} color={palette.fg} />
                        <Text style={{ color: palette.fg }}>{syncBusy ? 'Syncing...' : 'Sync now'}</Text>
                      </View>
                    </Pressable>
                  )}
                  
                  <Pressable style={[styles.smallBtn, styles.actionBtn, { borderColor: palette.border }]} onPress={logout}>
                    <View style={styles.inlineAction}>
                      <Ionicons name="log-out-outline" size={16} color={palette.fg} />
                      <Text style={{ color: palette.fg }}>{user ? 'Logout' : 'Exit Guest Mode'}</Text>
                    </View>
                  </Pressable>
                </View>
              </View>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        transparent={true}
        visible={qrModalVisible}
        onRequestClose={() => setQrModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setQrModalVisible(false)}>
          <View style={[styles.modalView, { backgroundColor: palette.card }]}>
            <View style={styles.qrContainer}>
              <QRCode
                value={qrData}
                size={width * 0.7}
                backgroundColor="white"
                color="black"
              />
            </View>
            <Text style={{ color: palette.muted, marginTop: 16, fontSize: 12 }}>Scan this code to import</Text>
          </View>
        </Pressable>
      </Modal>

      {selection.size > 0 ? (
        <View style={[styles.selectionFooter, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Pressable onPress={() => setSelection(new Set())} style={styles.selectionBtn}>
            <Ionicons name="close" size={24} color={palette.fg} />
          </Pressable>
          <Text style={{ color: palette.fg, fontWeight: '700' }}>{selection.size} selected</Text>
          <Pressable onPress={handleShare} style={styles.selectionBtn}>
            <Ionicons name="share-outline" size={24} color={palette.accent} />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.footer, { backgroundColor: palette.card, borderColor: palette.border }]}>
          {(['scan', 'history', 'settings'] as Tab[]).map((tab) => (
            <Pressable key={tab} onPress={() => setActiveTab(tab)} style={styles.footerBtn}>
              <View style={styles.footerBtnInner}>
                {tabIcon(tab, activeTab === tab)}
                <Text style={{ color: activeTab === tab ? palette.accent : palette.muted, fontWeight: '700' }}>{tab.toUpperCase()}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );

  return (
    <SimpleErrorBoundary>
      {content}
    </SimpleErrorBoundary>
  );
}

export default function MainAppScreen() {
  return <MainApp />;
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
  brandBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.8, marginBottom: 2 },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  logoShell: {
    borderWidth: 1,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  logoHalo: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 18,
    transform: [{ rotate: '12deg' }],
  },
  logoCore: {
    width: '72%',
    height: '72%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  logoBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  logoBar: { width: 4, borderRadius: 99 },
  logoBarThin: { width: 2, borderRadius: 99, opacity: 0.9 },
  content: { flex: 1 },
  screen: { flex: 1, padding: 12, gap: 10 },
  settingsContent: { paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  camera: { flex: 1, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  cameraCompact: { minHeight: 260 },
  rowButtons: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  btnContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
  smallBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  actionBtn: { minWidth: 120 },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginTop: 10 },
  pasteInput: { minHeight: 110 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 4, marginTop: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  listContent: { paddingBottom: 18 },
  code: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  footer: { borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row' },
  footerBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  footerBtnInner: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  selectionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  selectionBtn: {
    padding: 8,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalView: {
    margin: 20,
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  qrContainer: {
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 8,
  },
});
