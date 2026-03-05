import { diag } from "./diagnostics.js";

const STORAGE_KEY = "barra_templates";

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

export const templatesStore = {
  async getAll(fbService) {
    const local = safeParse(localStorage.getItem(STORAGE_KEY), []);
    if (!fbService?.enabled || !fbService.currentUser || !fbService.db) {
      return sortNewestFirst(local);
    }

    try {
      const { collection, getDocs, query } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const ref = collection(fbService.db, "users", fbService.currentUser.uid, "templates");
      const snap = await getDocs(query(ref));
      const remote = [];
      snap.forEach((docSnap) => remote.push({ id: docSnap.id, ...docSnap.data() }));
      const merged = sortNewestFirst([...local, ...remote]);
      return dedupeById(merged);
    } catch (error) {
      diag.warn("templates.remote_load_failed", { message: error?.message || String(error) });
      return sortNewestFirst(local);
    }
  },

  async save(template, fbService) {
    const now = new Date().toISOString();
    const payload = {
      id: template.id || `tpl_${Date.now()}`,
      name: template.name || "Template",
      type: template.type || "generic",
      regexRules: template.regexRules || {},
      mappingRules: template.mappingRules || {},
      samplePayloads: template.samplePayloads || [],
      createdAt: template.createdAt || now,
      updatedAt: now,
    };

    const local = safeParse(localStorage.getItem(STORAGE_KEY), []);
    const filtered = local.filter((t) => t.id !== payload.id);
    filtered.unshift(payload);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, 200)));

    if (fbService?.enabled && fbService.currentUser && fbService.db) {
      try {
        const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const ref = doc(fbService.db, "users", fbService.currentUser.uid, "templates", payload.id);
        await setDoc(ref, payload, { merge: true });
      } catch (error) {
        diag.warn("templates.remote_save_failed", { message: error?.message || String(error) });
      }
    }

    return payload;
  },
};

function dedupeById(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}
