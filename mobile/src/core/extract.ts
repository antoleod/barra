import { TemplateRule } from '../types';

function matchFirst(text: string, regex: RegExp): string {
  const m = text.match(regex);
  return m?.[1]?.trim() || '';
}

export function extractFields(rawText: string, templates: TemplateRule[]): Record<string, string> {
  const text = String(rawText || '').trim();
  if (!text) return {};

  for (const t of templates) {
    const out: Record<string, string> = {};
    for (const [field, pattern] of Object.entries(t.regexRules || {})) {
      try {
        const value = matchFirst(text, new RegExp(pattern, 'im'));
        if (value) out[field] = value;
      } catch {
        // ignore invalid regex
      }
    }
    if (Object.keys(out).length) return { ...out, _templateId: t.id };
  }

  const defaults: Record<string, string> = {
    ticketNumber: matchFirst(text, /(RITM\d+|REQ\d+|INC\d+|SCTASK\d+)/i),
    customerId: matchFirst(text, /customer\s*id\s*[:#-]?\s*([A-Z0-9_-]+)/i),
    shortDescription: matchFirst(text, /short\s*description\s*[:#-]?\s*(.+)/i),
    officeNumber: matchFirst(text, /office\s*(?:number|no)?\s*[:#-]?\s*([A-Z0-9-]+)/i),
    phoneNumber: matchFirst(text, /(\+?\d[\d\s().-]{6,}\d)/i),
    email: matchFirst(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),
  };

  return Object.fromEntries(Object.entries(defaults).filter(([, v]) => !!v));
}

