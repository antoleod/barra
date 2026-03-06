export type BootStatus = 'booting' | 'ready' | 'error';
export type AuthStatus = 'unknown' | 'authenticated' | 'guest';
export type PersistenceMode = 'local' | 'firebase';

export interface AppSettings {
  fullPrefix: string;
  shortPrefix: string;
  ocrCorrection: boolean;
  autoDetect: boolean;
  scanProfile: string;
  serviceNowBaseUrl: string;
  theme: 'dark' | 'light' | 'eu_blue';
  customAccent: string;
}

export interface TemplateRule {
  id: string;
  name: string;
  type: string;
  regexRules: Record<string, string>;
  mappingRules: Record<string, string>;
  samplePayloads: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ScanRecord {
  id: string;
  codeOriginal: string;
  codeNormalized: string;
  type: string;
  profileId: string;
  piMode: string;
  source: 'camera' | 'image' | 'nfc' | 'paste';
  structuredFields: Record<string, string>;
  date: string;
  status: 'pending' | 'sent';
  used: boolean;
  dateUsed: string | null;
}

