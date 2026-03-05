
import { fbService } from "./firebase-service.js";
import { diag } from "./diagnostics.js";
import { createScanProfiles } from "./scan-profiles.js";
import { ScannerController } from "./scannerController.js";
import { classifyScan, classifyManualProfile } from "./classify.js";
import { extractStructuredFields } from "./extract.js";
import { templatesStore } from "./templatesStore.js";
import { themeManager } from "./theme.js";
import { applyBootUiState, hideLoaderShowShell } from "./ui/layout.js";

const db = {
  dbName: "BarraScannerDB",
  version: 3,
  instance: null,
  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = (event) => {
        const d = event.target.result;
        let s;
        if (!d.objectStoreNames.contains("scans")) s = d.createObjectStore("scans", { keyPath: "id", autoIncrement: true });
        else s = req.transaction.objectStore("scans");
        if (!s.indexNames.contains("code_normalized")) s.createIndex("code_normalized", "code_normalized", { unique: false });
        if (!s.indexNames.contains("status")) s.createIndex("status", "status", { unique: false });
        if (!s.indexNames.contains("type")) s.createIndex("type", "type", { unique: false });
        if (!s.indexNames.contains("profileId")) s.createIndex("profileId", "profileId", { unique: false });
      };
      req.onsuccess = (e) => { this.instance = e.target.result; resolve(this.instance); };
      req.onerror = () => reject(req.error);
    });
  },
  addScan(x) {
    return new Promise((resolve, reject) => {
      const q = this.instance.transaction(["scans"], "readwrite").objectStore("scans").add(x);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  },
  getAll() {
    return new Promise((resolve) => {
      const q = this.instance.transaction(["scans"], "readonly").objectStore("scans").getAll();
      q.onsuccess = () => resolve(q.result || []);
    });
  },
  async updateStatus(id, status) {
    const store = this.instance.transaction(["scans"], "readwrite").objectStore("scans");
    const item = await new Promise((resolve) => { const q = store.get(id); q.onsuccess = (e) => resolve(e.target.result); });
    if (item) { item.status = status; store.put(item); }
  },
  async markUsed(id) {
    const store = this.instance.transaction(["scans"], "readwrite").objectStore("scans");
    const item = await new Promise((resolve) => { const q = store.get(id); q.onsuccess = (e) => resolve(e.target.result); });
    if (item) { item.used = true; item.dateUsed = new Date().toISOString(); store.put(item); }
  },
  clear() {
    return new Promise((resolve) => {
      const tx = this.instance.transaction(["scans"], "readwrite");
      tx.objectStore("scans").clear();
      tx.oncomplete = resolve;
    });
  },
};

const logic = {
  settings: {
    fullPrefix: "02PI20",
    shortPrefix: "MUSTBRUN",
    ocrCorrection: true,
    scanProfile: "auto",
    autoDetect: true,
    themeName: "dark",
    customAccent: "",
    serviceNowBaseUrl: "",
  },
  loadSettings() {
    const raw = localStorage.getItem("barra_settings");
    if (raw) {
      try { this.settings = { ...this.settings, ...JSON.parse(raw) }; } catch {}
    }
  },
  saveSettings() {
    localStorage.setItem("barra_settings", JSON.stringify(this.settings));
  },
  normalize(code) {
    let c = (code || "").trim().toUpperCase().replace(/\s+/g, "");
    if (this.settings.ocrCorrection) c = c.replace(/O/g, "0");
    return c;
  },
  convert(code, targetMode) {
    const c = this.normalize(code), f = this.settings.fullPrefix, s = this.settings.shortPrefix, isFull = c.startsWith(f), isShort = c.startsWith(s) || (!isFull && /^[A-Z0-9]+$/.test(c));
    if (targetMode === "SHORT") {
      if (isShort) return c;
      if (isFull) { const core = c.substring(f.length, c.length - 2); return s + core; }
    } else {
      if (isFull) return c;
      if (isShort) { let core = c; if (c.startsWith(s)) core = c.substring(s.length); return f + core + "00"; }
    }
    return null;
  },
  validate(code, mode) {
    const c = this.normalize(code);
    if (c.length < 5) return false;
    if (mode === "FULL" && !c.startsWith(this.settings.fullPrefix)) return false;
    return true;
  },
};

const app = {
  state: {
    bootStatus: "booting",
    authStatus: "unknown",
    persistenceMode: "local",
  },
  profiles: [],
  scans: [],
  templates: [],
  filter: "all",
  filterType: "all",
  isHandling: false,
  lastCode: "",
  lastAt: 0,
  syncIntervalId: null,
  scannerCtrl: null,
  confirmCallback: null,
  get els() {
    return {
      modeTag: document.getElementById("mode-tag"), profileTag: document.getElementById("profile-tag"),
      live: document.getElementById("live"), dot: document.getElementById("dot"), offline: document.getElementById("offline"),
      firebaseMode: document.getElementById("firebase-mode"), search: document.getElementById("search"), typeFilter: document.getElementById("type-filter"),
      log: document.getElementById("log"), recent: document.getElementById("recent-scans-container"),
      syncBtn: document.getElementById("sync-btn"), navSyncBtn: document.getElementById("n-sync"),
      backdrop: document.getElementById("backdrop"), fileInput: document.getElementById("file"),
      mTotal: document.getElementById("m-total"), mPending: document.getElementById("m-pending"), mBatch: document.getElementById("m-batch"),
      profileSelect: document.getElementById("scan-profile-select"), modeFull: document.getElementById("mode-full"), modeShort: document.getElementById("mode-short"), piModeGroup: document.getElementById("pi-mode-group"),
      ocrToggle: document.getElementById("ocr-toggle"), fullPrefix: document.getElementById("full-prefix"), shortPrefix: document.getElementById("short-prefix"),
      autoDetectToggle: document.getElementById("auto-detect-toggle"), serviceNowBaseUrl: document.getElementById("sn-base-url"),
      recheckFirebaseBtn: document.getElementById("recheck-firebase-btn"),
      themeSelect: document.getElementById("theme-select"), accentInput: document.getElementById("accent-color"),
      exportBtn: document.getElementById("export-btn"), clearBtn: document.getElementById("clear-btn"), resetBtn: document.getElementById("reset-state-btn"),
      copyLogsBtn: document.getElementById("copy-logs-btn"), exportLogsBtn: document.getElementById("export-logs-btn"), clearLogsBtn: document.getElementById("clear-logs-btn"),
      pasteBtn: document.getElementById("paste-ticket-btn"),
      confirmModal: document.getElementById("confirm-modal"), cmCancel: document.getElementById("cm-cancel-btn"), cmConfirm: document.getElementById("cm-confirm-btn"), cmTitle: document.getElementById("cm-title"), cmMessage: document.getElementById("cm-message"), cmIcon: document.getElementById("cm-icon"),
      baBtn: document.getElementById("ba-btn"), bigAlert: document.getElementById("big-alert"), baBox: document.getElementById("ba-box"), baTitle: document.getElementById("ba-title"), baCode: document.getElementById("ba-code"), baIcon: document.getElementById("ba-icon"),
    };
  },
  async init() {
    diag.info("boot.start");
    this.profiles = [{ id: "auto", label: "Auto Detect", shortLabel: "AUTO", type: "AUTO" }, ...createScanProfiles(logic)];
    this.bind();
    this.forceInitialUiState();
    await db.init();
    logic.loadSettings();
    this.applySettingsToUi();
    this.templates = await templatesStore.getAll(fbService);
    await this.loadScans();
    this.initScannerController();
    this.registerSW();
    this.state.bootStatus = "ready";
    hideLoaderShowShell();
    this.initFirebase();
    this.updateConnectionStatus();
    if (this.canUseScanner()) await this.startScanner();
    this.startAutoSync();
    diag.info("boot.ready");
  },
  initScannerController() {
    this.scannerCtrl = new ScannerController({
      readerId: "reader",
      onDecoded: (decoded) => this.onScan(decoded),
      onStatus: (msg) => this.status(msg),
    });
  },
  bind() {
    const byId = (id) => document.getElementById(id);
    byId("n-history").onclick = () => this.openPanel("history");
    byId("n-settings").onclick = () => this.openPanel("settings");
    byId("n-image").onclick = () => this.els.fileInput.click();
    byId("n-nfc").onclick = () => this.startNFC();
    byId("n-sync").onclick = () => this.runFullSync();
    this.els.syncBtn.onclick = () => this.runFullSync();

    this.els.search.oninput = (e) => this.renderList(e.target.value || "");
    this.els.typeFilter.onchange = (e) => { this.filterType = e.target.value; this.renderList(this.els.search.value || ""); };
    document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => this.filterList(t.dataset.filter || "all"); });
    this.els.fileInput.onchange = (e) => this.scanImage(e);

    this.els.profileSelect.onchange = (e) => { logic.settings.scanProfile = e.target.value; logic.saveSettings(); this.updateProfileUi(); };
    this.els.modeFull.onclick = () => this.setPiMode("FULL");
    this.els.modeShort.onclick = () => this.setPiMode("SHORT");
    this.els.ocrToggle.onchange = () => { logic.settings.ocrCorrection = this.els.ocrToggle.checked; logic.saveSettings(); };
    this.els.fullPrefix.onchange = () => { logic.settings.fullPrefix = this.els.fullPrefix.value.trim().toUpperCase(); logic.saveSettings(); };
    this.els.shortPrefix.onchange = () => { logic.settings.shortPrefix = this.els.shortPrefix.value.trim().toUpperCase(); logic.saveSettings(); };
    this.els.autoDetectToggle.onchange = () => { logic.settings.autoDetect = this.els.autoDetectToggle.checked; logic.saveSettings(); this.updateProfileUi(); };
    this.els.serviceNowBaseUrl.onchange = () => { logic.settings.serviceNowBaseUrl = this.els.serviceNowBaseUrl.value.trim(); logic.saveSettings(); };
    this.els.recheckFirebaseBtn.onclick = () => this.recheckFirebase();
    this.els.themeSelect.onchange = () => this.applyThemeFromUi();
    this.els.accentInput.onchange = () => this.applyThemeFromUi();

    this.els.exportBtn.onclick = () => this.exportCSV();
    this.els.clearBtn.onclick = () => this.clearDB();
    this.els.resetBtn.onclick = () => this.resetAppState();
    this.els.pasteBtn.onclick = () => this.pasteTicketText();

    this.els.copyLogsBtn.onclick = () => this.copyLogs();
    this.els.exportLogsBtn.onclick = () => this.exportLogsJson();
    this.els.clearLogsBtn.onclick = () => this.clearLogs();

    this.els.backdrop.onclick = () => this.closePanels();
    document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => this.closePanels(); });
    this.els.baBtn.onclick = () => this.els.bigAlert.classList.remove("on");
    this.els.bigAlert.onclick = (e) => { if (e.target.id === "big-alert") this.els.bigAlert.classList.remove("on"); };

    this.els.cmCancel.onclick = () => this.hideConfirmation();
    this.els.cmConfirm.onclick = () => { if (this.confirmCallback) this.confirmCallback(); };
    this.els.confirmModal.onclick = (e) => { if (e.target.id === "confirm-modal") this.hideConfirmation(); };

    window.addEventListener("online", () => { this.updateConnectionStatus(); this.startAutoSync(); });
    window.addEventListener("offline", () => { this.updateConnectionStatus(); this.stopAutoSync(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.closePanels(); });
  },
  applyThemeFromUi() {
    logic.settings.themeName = this.els.themeSelect.value;
    logic.settings.customAccent = this.els.accentInput.value || "";
    logic.saveSettings();
    themeManager.apply(logic.settings.themeName, logic.settings.customAccent);
  },
  applySettingsToUi() {
    const storedTheme = themeManager.loadStored();
    if (storedTheme && !logic.settings.themeName) {
      logic.settings.themeName = storedTheme.themeName || "dark";
      logic.settings.customAccent = storedTheme.customAccent || "";
    }
    themeManager.apply(logic.settings.themeName, logic.settings.customAccent);

    this.els.profileSelect.innerHTML = this.profiles.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
    if (!this.profiles.find((p) => p.id === logic.settings.scanProfile)) logic.settings.scanProfile = "auto";
    this.els.profileSelect.value = logic.settings.scanProfile;
    this.els.modeFull.classList.remove("on");
    this.els.modeShort.classList.remove("on");
    this.els.ocrToggle.checked = !!logic.settings.ocrCorrection;
    this.els.fullPrefix.value = logic.settings.fullPrefix;
    this.els.shortPrefix.value = logic.settings.shortPrefix;
    this.els.autoDetectToggle.checked = logic.settings.autoDetect !== false;
    this.els.serviceNowBaseUrl.value = logic.settings.serviceNowBaseUrl || "";
    this.els.themeSelect.value = logic.settings.themeName || "dark";
    this.els.accentInput.value = logic.settings.customAccent || "";
    this.updateProfileUi();
  },
  updateProfileUi() {
    const profile = this.getCurrentProfile();
    const isAuto = logic.settings.autoDetect && profile.id === "auto";
    const isPi = profile.id === "pi_full" || profile.id === "pi_short";
    this.els.piModeGroup.classList.toggle("is-disabled", !isPi);
    this.els.modeFull.disabled = !isPi;
    this.els.modeShort.disabled = !isPi;
    this.els.modeFull.classList.toggle("on", logic.settings.scanProfile === "pi_full");
    this.els.modeShort.classList.toggle("on", logic.settings.scanProfile === "pi_short");
    this.els.modeTag.textContent = isAuto ? "AUTO" : profile.label;
    this.els.profileTag.textContent = isAuto ? "AUTO" : profile.shortLabel;
  },
  forceInitialUiState() {
    document.querySelectorAll(".panel").forEach((p) => { p.classList.remove("on"); p.setAttribute("aria-hidden", "true"); });
    this.els.backdrop.classList.remove("on");
    document.body.classList.remove("panel-open");
  },
  status(text) { this.els.live.textContent = text; },
  setNav(id) { document.querySelectorAll("#nav .n").forEach((b) => b.classList.toggle("on", b.id === id)); },
  async runWithScannerIdle(label, action, resume = true) {
    if (!this.scannerCtrl) return action();
    return this.scannerCtrl.runWithScannerIdle(label, action, resume && this.canUseScanner());
  },
  async openPanel(id) {
    await this.runWithScannerIdle(`openPanel:${id}`, async () => {
      this.closePanels(false, false);
      const p = document.getElementById(id);
      if (!p) return;
      p.classList.add("on");
      p.setAttribute("aria-hidden", "false");
      this.els.backdrop.classList.add("on");
      document.body.classList.add("panel-open");
      diag.info("panel.open", { panel: id });
    }, false);
  },
  closePanels(resetNav = true, resumeScanner = true) {
    document.querySelectorAll(".panel.on").forEach((p) => { p.classList.remove("on"); p.setAttribute("aria-hidden", "true"); diag.info("panel.close", { panel: p.id }); });
    this.els.backdrop.classList.remove("on");
    document.body.classList.remove("panel-open");
    if (resetNav) this.setNav("");
    if (resumeScanner && this.canUseScanner()) this.startScanner();
  },
  registerSW() { if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {}); },
  showConfirmation({ title, message, icon = "?", confirmText = "Confirm", onConfirm }) {
    this.els.cmTitle.textContent = title;
    this.els.cmMessage.textContent = message;
    this.els.cmIcon.textContent = icon;
    this.els.cmConfirm.textContent = confirmText;
    this.confirmCallback = onConfirm;
    this.els.confirmModal.classList.add("on");
  },
  hideConfirmation() { this.els.confirmModal.classList.remove("on"); this.confirmCallback = null; },
  toast(msg, type = "info", dur = 2200) {
    const c = document.getElementById("toast"), t = document.createElement("div");
    t.className = `t ${type}`;
    t.innerHTML = `<span>${type === "success" ? "OK" : type === "error" ? "X" : "i"}</span><span>${msg}</span>`;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); t.addEventListener("transitionend", () => t.remove(), { once: true }); }, dur);
  },
  updateConnectionStatus() {
    const online = navigator.onLine;
    this.els.offline.style.display = online ? "none" : "inline";
    this.els.dot.classList.remove("offline", "warning");
    if (!online) this.els.dot.classList.add("offline");

    this.state.persistenceMode = fbService.enabled ? "firebase" : "local";
    this.state.authStatus = fbService.enabled ? (fbService.currentUser ? "authenticated" : "guest") : "guest";
    applyBootUiState(this.state);

    if (!fbService.enabled) {
      this.disableSyncUi(true);
      this.status("Local mode active");
      return;
    }

    this.disableSyncUi(!fbService.currentUser);
    if (!fbService.currentUser) this.els.dot.classList.add("warning");
    this.status(fbService.currentUser ? "Ready to scan" : "Waiting for authentication...");
  },
  disableSyncUi(disabled) {
    this.els.syncBtn.disabled = disabled;
    this.els.navSyncBtn.disabled = disabled;
  },
  initFirebase() {
    fbService.init((user) => {
      this.state.authStatus = user ? "authenticated" : "guest";
      this.state.persistenceMode = fbService.enabled ? "firebase" : "local";
      this.updateConnectionStatus();
      if (fbService.enabled && !user) {
        window.location.replace("./login.html");
        return;
      }
      if (this.canUseScanner()) this.startScanner();
      this.startAutoSync();
    });
  },
  canUseScanner() { return !fbService.enabled || !!fbService.currentUser; },
  async recheckFirebase() {
    await this.runWithScannerIdle("recheckFirebase", async () => {
      this.toast("Rechecking Firebase...", "info", 900);
      const result = await fbService.recheckConfig();
      this.updateConnectionStatus();
      this.toast(result.enabled ? "Firebase available" : "Firebase unavailable (local mode)", result.enabled ? "success" : "warning", 1800);
    }, false);
  },
  getCurrentProfile() { return this.profiles.find((p) => p.id === logic.settings.scanProfile) || this.profiles[0]; },
  updateMetrics() {
    const pending = this.scans.filter((s) => s.status === "pending").length;
    this.els.mTotal.textContent = `${this.scans.length} records`;
    this.els.mPending.textContent = `${pending} pending`;
    this.els.mBatch.textContent = `Mode ${logic.settings.autoDetect ? "AUTO" : "MANUAL"}`;
  },
  async loadScans() {
    this.scans = await db.getAll();
    this.renderTypeFilterOptions();
    this.renderList(this.els.search.value || "");
    this.updateMetrics();
    this.updateRecentScansFooter();
  },
  renderTypeFilterOptions() {
    const types = ["all", ...new Set(this.scans.map((s) => s.type || "UNKNOWN"))];
    this.els.typeFilter.innerHTML = types.map((type) => `<option value="${type}">${type === "all" ? "All Types" : type}</option>`).join("");
    if (!types.includes(this.filterType)) this.filterType = "all";
    this.els.typeFilter.value = this.filterType;
  },
  filterList(type) {
    this.filter = type;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.filter === type));
    this.renderList(this.els.search.value || "");
  },
  updateRecentScansFooter() {
    const c = this.els.recent;
    const recent = this.scans.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    c.innerHTML = "";
    if (!recent.length) { c.innerHTML = '<span class="recent-placeholder">Recent records...</span>'; return; }
    recent.forEach((s) => {
      const e = document.createElement("span");
      e.className = "recent-item";
      e.textContent = `[${s.type || "UNK"}] ${s.code_normalized}`;
      c.appendChild(e);
    });
  },
  renderList(term = "") {
    const list = this.els.log;
    list.innerHTML = "";
    const rows = this.scans
      .filter((s) => (this.filter === "pending" ? s.status === "pending" : this.filter === "sent" ? s.status === "sent" : true))
      .filter((s) => (this.filterType === "all" ? true : (s.type || "UNKNOWN") === this.filterType))
      .filter((s) => (s.code_normalized || "").toLowerCase().includes(term.toLowerCase()))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!rows.length) {
      const d = document.createElement("div");
      d.className = "item";
      d.textContent = "No records to display.";
      list.appendChild(d);
      return;
    }

    rows.forEach((scan) => {
      const li = document.createElement("li");
      li.className = "item";
      const dt = new Date(scan.date).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const openBtn = scan.type && /RITM|REQ|INC|SCTASK/.test(scan.type) && logic.settings.serviceNowBaseUrl
        ? `<button class="btn" data-open-url="${scan.id}">Open ticket</button>` : "";
      li.innerHTML = `<div class="ih"><div class="code">${scan.code_normalized}</div><div class="time">${dt}</div></div><div class="meta"><span class="badge badge-type">${scan.type || "UNK"}</span><span class="badge badge-profile">${(scan.profileId || "legacy").toUpperCase()}</span><span class="badge badge-${scan.status}">${scan.status}</span>${scan.used ? '<span class="badge badge-used">USED</span>' : ""}</div><div style="display:flex;gap:8px;justify-content:flex-end">${openBtn}${!scan.used ? `<button class="btn" data-used="${scan.id}">Mark used</button>` : ""}<button class="btn" data-template="${scan.id}">Save template</button></div>`;
      list.appendChild(li);
    });

    list.querySelectorAll("[data-used]").forEach((b) => { b.onclick = () => this.markUsed(Number(b.dataset.used)); });
    list.querySelectorAll("[data-template]").forEach((b) => { b.onclick = () => this.saveTemplateFromScan(Number(b.dataset.template)); });
    list.querySelectorAll("[data-open-url]").forEach((b) => { b.onclick = () => this.openTicketUrl(Number(b.dataset.openUrl)); });
  },
  async markUsed(id) { await db.markUsed(id); await this.loadScans(); },
  openTicketUrl(id) {
    const item = this.scans.find((s) => s.id === id);
    if (!item) return;
    const base = logic.settings.serviceNowBaseUrl || "";
    const url = `${base.replace(/\/$/, "")}/${encodeURIComponent(item.code_normalized)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async saveTemplateFromScan(id) {
    const item = this.scans.find((s) => s.id === id);
    if (!item) return;
    const name = window.prompt("Template name", `${item.type || "generic"}-${Date.now()}`);
    if (!name) return;
    const template = {
      name,
      type: item.type || "generic",
      regexRules: item.type === "PI"
        ? { ticketNumber: `(${logic.settings.fullPrefix}[A-Z0-9]+)` }
        : { ticketNumber: "(RITM\\d+|REQ\\d+|INC\\d+|SCTASK\\d+)" },
      samplePayloads: [item.code_original],
    };
    await templatesStore.save(template, fbService);
    this.templates = await templatesStore.getAll(fbService);
    this.toast("Template saved", "success", 1200);
  },
  getPiMode(profileId, classified) {
    if (classified?.piMode) return classified.piMode;
    if (profileId === "pi_short") return "SHORT";
    if (profileId === "pi_full") return "FULL";
    return "N/A";
  },
  classify(raw) {
    if (logic.settings.autoDetect || logic.settings.scanProfile === "auto") return classifyScan(raw, logic);
    return classifyManualProfile(raw, logic.settings.scanProfile, logic);
  },
  validateClassified(c) {
    if (!c || !c.normalized) return false;
    if (c.type === "PI") return logic.validate(c.normalized, c.piMode || "FULL");
    if (c.type === "QR") return String(c.normalized).trim().length > 0;
    if (c.type === "RITM") return /^RITM\d+$/i.test(c.normalized);
    if (c.type === "REQ") return /^REQ\d+$/i.test(c.normalized);
    if (c.type === "INC") return /^INC\d+$/i.test(c.normalized);
    if (c.type === "SCTASK") return /^SCTASK\d+$/i.test(c.normalized);
    return true;
  },
  async processScan(raw, source = "scan") {
    const classified = this.classify(raw);
    if (!this.validateClassified(classified)) {
      this.toast("Invalid scan format", "warning");
      return { ok: false };
    }

    const duplicate = this.scans.find((s) => s.code_normalized === classified.normalized && s.type === classified.type);
    if (duplicate) {
      this.showBigAlert("DUPLICATE", classified.normalized, "warning");
      return { ok: false, duplicate: true };
    }

    const structuredFields = extractStructuredFields(raw, this.templates);
    const record = {
      code_original: String(raw || ""),
      code_normalized: classified.normalized,
      profileId: classified.profileId || logic.settings.scanProfile,
      type: classified.type || "QR",
      pi_mode: this.getPiMode(classified.profileId, classified),
      source,
      structuredFields,
      date: new Date().toISOString(),
      status: "pending",
      used: false,
      dateUsed: null,
      layout: "QWERTY",
    };

    await db.addScan(record);
    await this.loadScans();
    this.els.profileTag.textContent = logic.settings.autoDetect ? `AUTO-${record.type}` : record.type;
    return { ok: true, record };
  },
  async onScan(raw) {
    if (this.isHandling) return;
    const now = Date.now();
    if (raw === this.lastCode && now - this.lastAt < 1200) return;
    this.lastCode = raw;
    this.lastAt = now;
    this.isHandling = true;
    try {
      const result = await this.processScan(raw, "camera");
      if (!result.ok) {
        await this.scannerCtrl.pause(result.duplicate ? 1600 : 700, this.canUseScanner());
        return;
      }
      this.status(`Saved: ${result.record.code_normalized}`);
      this.toast("Saved", "success", 900);
      await this.scannerCtrl.pause(1000, this.canUseScanner());
    } finally {
      this.isHandling = false;
    }
  },
  async startScanner() { if (this.canUseScanner()) await this.scannerCtrl?.start(); },
  async stopScanner() { await this.scannerCtrl?.stop(); },
  async scanImage(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    await this.runWithScannerIdle("scanImage", async () => {
      const temp = new Html5Qrcode("reader");
      try {
        const decoded = await temp.scanFile(file, true);
        await this.processScan(decoded, "image");
      } catch {
        this.toast("No code detected in image", "warning");
      } finally {
        await temp.clear().catch(() => {});
        event.target.value = "";
      }
    });
  },
  async startNFC() {
    await this.runWithScannerIdle("startNFC", async () => {
      if (!("NDEFReader" in window)) { this.toast("NFC not supported", "error"); return; }
      const n = new NDEFReader();
      await n.scan();
      this.toast("NFC listening...", "info", 1200);
      n.onreading = async (e) => {
        if (e.serialNumber) return this.processScan(e.serialNumber.replace(/:/g, "").toUpperCase(), "nfc");
        for (const r of e.message?.records || []) {
          if (r.recordType !== "text") continue;
          try {
            const langLen = r.data.getUint8(0) & 63;
            const text = new TextDecoder(r.encoding).decode(new DataView(r.data.buffer, r.data.byteOffset + 1 + langLen, r.data.byteLength - 1 - langLen));
            await this.processScan(text, "nfc");
            return;
          } catch {}
        }
      };
      n.onreadingerror = () => this.toast("NFC read error", "error");
    }, false);
  },
  async pasteTicketText() {
    await this.runWithScannerIdle("pasteTicket", async () => {
      const text = window.prompt("Paste ticket text");
      if (!text || !text.trim()) return;
      await this.processScan(text, "paste");
      this.toast("Pasted text processed", "success", 1200);
    }, false);
  },
  async clearDB() {
    await this.runWithScannerIdle("clearHistory", async () => {
      this.showConfirmation({
        title: "Clear history",
        message: "Remove all local records?",
        icon: "!",
        confirmText: "Clear",
        onConfirm: async () => {
          await db.clear();
          await this.loadScans();
          this.hideConfirmation();
        },
      });
    }, false);
  },
  async resetAppState() {
    await this.runWithScannerIdle("resetState", async () => {
      this.closePanels();
      this.filter = "all";
      this.filterType = "all";
      this.els.search.value = "";
      this.renderList("");
      this.toast("UI state reset", "success", 1000);
    }, false);
  },
  exportCSV() {
    const h = ["ID", "Code", "Type", "ProfileId", "PiMode", "Date", "Status", "Used", "StructuredFields"];
    const rows = this.scans.map((s) => [s.id, s.code_normalized, s.type, s.profileId, s.pi_mode, s.date, s.status, s.used, JSON.stringify(s.structuredFields || {})]);
    const csv = [h.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `barra_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  async copyLogs() {
    try { await navigator.clipboard.writeText(diag.getText() || "No logs"); this.toast("Logs copied", "success"); }
    catch { this.toast("Clipboard blocked", "error"); }
  },
  exportLogsJson() {
    const blob = new Blob([diag.getJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `barra_logs_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  clearLogs() { diag.clear(); this.toast("Logs cleared", "success"); },
  showBigAlert(title, code, type) {
    this.els.baTitle.textContent = title;
    this.els.baCode.textContent = code;
    this.els.baIcon.textContent = type === "warning" ? "!" : "i";
    this.els.baBox.className = `ba-box ${type}`;
    this.els.bigAlert.classList.add("on");
  },
  startAutoSync() {
    if (!fbService.enabled || !fbService.currentUser || this.syncIntervalId || !navigator.onLine) return;
    this.syncIntervalId = setInterval(() => this.runFullSync(true), 15000);
  },
  stopAutoSync() { if (this.syncIntervalId) { clearInterval(this.syncIntervalId); this.syncIntervalId = null; } },
  async runFullSync(silent = false) {
    if (!fbService.enabled || !fbService.currentUser) { if (!silent) this.toast("Sync unavailable", "warning"); return; }
    const pending = this.scans.filter((s) => s.status === "pending");
    try {
      const result = await fbService.syncScans(pending);
      if (result.pushedCount > 0) for (const item of pending) await db.updateStatus(item.id, "sent");
      await this.loadScans();
      if (!silent) this.toast("Sync complete", "success", 1000);
    } catch (error) {
      if (!silent) this.toast(error.message || "Sync error", "error");
    }
  },
};

document.addEventListener("DOMContentLoaded", () => {
  app.init().catch((error) => {
    diag.error("boot.failed", { message: error?.message || String(error) });
    app.state.bootStatus = "error";
    hideLoaderShowShell();
    applyBootUiState(app.state);
    app.status("Boot failed: local fallback active");
  });
});

window.app = app;
