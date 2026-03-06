import AsyncStorage from '@react-native-async-storage/async-storage';
import { TemplateRule } from '../types';

const KEY = 'barra_templates';

export async function loadTemplates(): Promise<TemplateRule[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      : [];
  } catch {
    return [];
  }
}

export async function saveTemplate(template: Omit<TemplateRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<TemplateRule[]> {
  const now = new Date().toISOString();
  const payload: TemplateRule = {
    id: template.id || `tpl_${Date.now()}`,
    name: template.name,
    type: template.type,
    regexRules: template.regexRules,
    mappingRules: template.mappingRules,
    samplePayloads: template.samplePayloads,
    createdAt: now,
    updatedAt: now,
  };

  const current = await loadTemplates();
  const next = [payload, ...current.filter((t) => t.id !== payload.id)].slice(0, 500);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

