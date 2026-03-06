import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScanRecord } from '../types';

const KEY = 'barra_history';

export async function loadHistory(): Promise<ScanRecord[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHistory(items: ScanRecord[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function addHistory(item: ScanRecord): Promise<ScanRecord[]> {
  const current = await loadHistory();
  const next = [item, ...current].slice(0, 5000);
  await saveHistory(next);
  return next;
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

