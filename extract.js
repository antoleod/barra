function matchFirst(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

export function extractStructuredFields(rawText, templates = []) {
  const text = String(rawText || "").trim();
  if (!text) return {};

  for (const template of templates) {
    if (!template?.regexRules) continue;
    const extracted = {};
    for (const [field, regexString] of Object.entries(template.regexRules)) {
      try {
        const value = matchFirst(text, new RegExp(regexString, "im"));
        if (value) extracted[field] = value;
      } catch {
        // ignore malformed template regex
      }
    }
    if (Object.keys(extracted).length > 0) {
      return { ...extracted, _templateId: template.id, _templateName: template.name };
    }
  }

  const defaults = {
    ticketNumber: matchFirst(text, /(RITM\d+|REQ\d+|INC\d+|SCTASK\d+)/i),
    customerId: matchFirst(text, /customer\s*id\s*[:#-]?\s*([A-Z0-9_-]+)/i),
    shortDescription: matchFirst(text, /short\s*description\s*[:#-]?\s*(.+)/i),
    description: matchFirst(text, /description\s*[:#-]?\s*([\s\S]{1,400})/i),
    officeNumber: matchFirst(text, /office\s*(?:number|no)?\s*[:#-]?\s*([A-Z0-9-]+)/i),
    phoneNumber: matchFirst(text, /(\+?\d[\d\s().-]{6,}\d)/i),
    email: matchFirst(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),
  };

  return Object.fromEntries(Object.entries(defaults).filter(([, v]) => v));
}
