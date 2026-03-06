import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from '../types';

const KEY = 'barra_settings';

export const defaultSettings: AppSettings = {
  fullPrefix: '02PI20',
  shortPrefix: 'MUSTBRUN',
  ocrCorrection: true,
  autoDetect: true,
  scanProfile: 'auto',
  serviceNowBaseUrl: '',
  theme: 'dark',
  customAccent: '',
};

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return defaultSettings;
  try {
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

// Keep PI conversion behavior identical to web app.
export const piLogic = {
  normalize(code: string, settings: AppSettings) {
    let c = (code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (settings.ocrCorrection) c = c.replace(/O/g, '0');
    return c;
  },
  convert(code: string, targetMode: 'FULL' | 'SHORT', settings: AppSettings) {
    const c = this.normalize(code, settings), f = settings.fullPrefix, s = settings.shortPrefix, isFull = c.startsWith(f), isShort = c.startsWith(s) || (!isFull && /^[A-Z0-9]+$/.test(c));
    if (targetMode === 'SHORT') {
      if (isShort) return c;
      if (isFull) { const core = c.substring(f.length, c.length - 2); return s + core; }
    } else {
      if (isFull) return c;
      if (isShort) { let core = c; if (c.startsWith(s)) core = c.substring(s.length); return f + core + '00'; }
    }
    return null;
  },
  validate(code: string, mode: 'FULL' | 'SHORT', settings: AppSettings) {
    const c = this.normalize(code, settings);
    if (c.length < 5) return false;
    if (mode === 'FULL' && !c.startsWith(settings.fullPrefix)) return false;
    return true;
  },
};

