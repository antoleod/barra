import { AppSettings } from '../types';
import { piLogic } from './settings';

export interface Classified {
  profileId: string;
  type: 'PI' | 'RITM' | 'REQ' | 'INC' | 'SCTASK' | 'QR' | 'TEST';
  normalized: string;
  piMode: 'FULL' | 'SHORT' | 'N/A';
}

export function classify(raw: string, settings: AppSettings): Classified {
  const compact = String(raw || '').trim().replace(/\s+/g, '');
  const upper = compact.toUpperCase();

  if (/^RITM\d+$/.test(upper)) return { profileId: 'auto', type: 'RITM', normalized: upper, piMode: 'N/A' };
  if (/^REQ\d+$/.test(upper)) return { profileId: 'auto', type: 'REQ', normalized: upper, piMode: 'N/A' };
  if (/^INC\d+$/.test(upper)) return { profileId: 'auto', type: 'INC', normalized: upper, piMode: 'N/A' };
  if (/^SCTASK\d+$/.test(upper)) return { profileId: 'auto', type: 'SCTASK', normalized: upper, piMode: 'N/A' };

  const piFull = piLogic.convert(upper, 'FULL', settings) || piLogic.normalize(upper, settings);
  if (piLogic.validate(piFull, 'FULL', settings)) {
    return { profileId: 'auto', type: 'PI', normalized: piFull, piMode: 'FULL' };
  }

  const piShort = piLogic.convert(upper, 'SHORT', settings) || piLogic.normalize(upper, settings);
  if (piLogic.validate(piShort, 'SHORT', settings)) {
    return { profileId: 'auto', type: 'PI', normalized: piShort, piMode: 'SHORT' };
  }

  return { profileId: 'auto', type: 'QR', normalized: String(raw || '').trim(), piMode: 'N/A' };
}

