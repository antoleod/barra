
import { fbService } from "./firebase-service.js";
import { diag } from "./diagnostics.js";
import { createScanProfiles } from "./scan-profiles.js";

const db = {
  dbName: "BarraScannerDB",
  version: 2,
  instance: null,
  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = (event) => {
        const database = event.target.result;
        let store;
        if (!database.objectStoreNames.contains("scans")) {
          store = database.createObjectStore("scans", { keyPath: "id", autoIncrement: true });
        } else {
          store = req.transaction.objectStore("scans");
        }
        if (!store.indexNames.contains("code_normalized")) store.createIndex("code_normalized", "code_normalized", { unique: false });
        if (!store.indexNames.contains("status")) store.createIndex("status", "status", { unique: false });
        if (!store.indexNames.contains("profileId")) store.createIndex("profileId", "profileId", { unique: false });
        if (!store.indexNames.contains("type")) store.createIndex("type", "type", { unique: false });
      };
      req.onsuccess = (event) => { this.instance = event.target.result; resolve(this.instance); };
      req.onerror = () => reject(req.error);
    });
  },
  addScan(scan) {
    return new Promise((resolve, reject) => {
      const tx = this.instance.transaction(["scans"], "readwrite");
      const q = tx.objectStore("scans").add(scan);
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
    const item = await new Promise((resolve) => { const q = store.get(id); q.onsuccess = (event) => resolve(event.target.result); });
    if (item) { item.status = status; store.put(item); }
  },
  async markUsed(id) {
    const store = this.instance.transaction(["scans"], "readwrite").objectStore("scans");
    const item = await new Promise((resolve) => { const q = store.get(id); q.onsuccess = (event) => resolve(event.target.result); });
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
    scriptUrl: "",
    theme: "midnight",
    scanProfile: "pi_full",
    apiEnabled: false,
    apiEndpoint: "",
    apiToken: "",
    apiTimeoutMs: 4000,
  },
  applyTheme(theme) {
    const validThemes = new Set(["midnight", "sunset", "forest", "ice"]);
    const selected = validThemes.has(theme) ? theme : "midnight";
    document.documentElement.setAttribute("data-theme", selected);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const colorByTheme = { midnight: "#0d1117", sunset: "#1a1212", forest: "#0d1712", ice: "#10161f" };
      meta.setAttribute("content", colorByTheme[selected] || colorByTheme.midnight);
    }
  },
  loadSettings() {
    const stored = localStorage.getItem("barra_settings");
    if (stored) {
      try { this.settings = { ...this.settings, ...JSON.parse(stored) }; } catch {}
    }
    this.applyTheme(this.settings.theme);
  },
  saveSettings() { localStorage.setItem("barra_settings", JSON.stringify(this.settings)); },
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
  scans: [], scanner: null, scannerState: "idle", syncIntervalId: null,
  isHandling: false, lastCode: "", lastAt: 0, restartTimer: null,
  pauseMs: 1300, filter: "all", filterType: "all", batchMode: false,
  batchCount: 0, batchLayout: "QWERTY", confirmCallback: null, profiles: [],
  get els() {
    return {
      appShell: document.querySelector(".app-shell"), appLoader: document.getElementById("app-loader"),
      backdrop: document.getElementById("backdrop"), modeTag: document.getElementById("mode-tag"),
      profileTag: document.getElementById("profile-tag"), firebaseMode: document.getElementById("firebase-mode"),
      live: document.getElementById("live"), syncBtn: document.getElementById("sync-btn"),
      navSyncBtn: document.getElementById("n-sync"), search: document.getElementById("search"),
      typeFilter: document.getElementById("type-filter"), log: document.getElementById("log"),
      recent: document.getElementById("recent-scans-container"), dot: document.getElementById("dot"),
      offline: document.getElementById("offline"), profileSelect: document.getElementById("scan-profile-select"),
      modeFull: document.getElementById("mode-full"), modeShort: document.getElementById("mode-short"),
      piModeGroup: document.getElementById("pi-mode-group"), batchToggle: document.getElementById("batch-toggle"),
      batchLayout: document.getElementById("batch-layout"), scriptUrl: document.getElementById("script-url"),
      ocrToggle: document.getElementById("ocr-toggle"), fullPrefix: document.getElementById("full-prefix"),
      shortPrefix: document.getElementById("short-prefix"), exportBtn: document.getElementById("export-btn"),
      clearBtn: document.getElementById("clear-btn"), refreshConfigBtn: document.getElementById("refresh-config-btn"),
      fileInput: document.getElementById("file"), apiEnabled: document.getElementById("api-enabled"),
      apiEndpoint: document.getElementById("api-endpoint"), apiToken: document.getElementById("api-token"),
      apiTimeout: document.getElementById("api-timeout"), apiResponse: document.getElementById("api-response"),
      testScanBtn: document.getElementById("test-scan-btn"), copyLogsBtn: document.getElementById("copy-logs-btn"),
      clearLogsBtn: document.getElementById("clear-logs-btn"), mTotal: document.getElementById("m-total"),
      mPending: document.getElementById("m-pending"), mBatch: document.getElementById("m-batch"),
      baBtn: document.getElementById("ba-btn"), bigAlert: document.getElementById("big-alert"),
      baBox: document.getElementById("ba-box"), baTitle: document.getElementById("ba-title"),
      baCode: document.getElementById("ba-code"), baIcon: document.getElementById("ba-icon"),
      confirmModal: document.getElementById("confirm-modal"), cmCancel: document.getElementById("cm-cancel-btn"),
      cmConfirm: document.getElementById("cm-confirm-btn"), cmTitle: document.getElementById("cm-title"),
      cmMessage: document.getElementById("cm-message"), cmIcon: document.getElementById("cm-icon"),
    };
  },
  async init() {
    diag.info("boot.start");
    this.profiles = createScanProfiles(logic);
    this.forceInitialUiState();
    this.bind();
    await db.init();
    logic.loadSettings();
    this.applySettingsToUi();
    await this.loadScans();
    this.registerSW();
    this.revealShell();
    this.updateConnectionStatus();
    this.initFirebase();
    if (this.canUseScanner()) await this.startScanner();
    this.startAutoSync();
    diag.info("boot.ready");
  },
  forceInitialUiState() {
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.remove("on");
      panel.setAttribute("aria-hidden", "true");
    });
    this.els.backdrop?.classList.remove("on");
    document.body.classList.remove("panel-open");
    this.setNav("");
  },
  revealShell() {
    const { appShell, appLoader } = this.els;
    if (appShell) { appShell.style.display = "block"; appShell.classList.add("ready"); }
    if (appLoader) { appLoader.style.opacity = "0"; setTimeout(() => appLoader.remove(), 320); }
    diag.info("loader.hidden");
  },
  bind() {
    const byId = (id) => document.getElementById(id);
    this.els.syncBtn.onclick = () => this.runFullSync();
    this.els.navSyncBtn.onclick = () => this.runFullSync();
    this.els.search.oninput = (event) => this.renderList(event.target.value || "");
    this.els.typeFilter.onchange = (event) => { this.filterType = event.target.value; this.renderList(this.els.search.value || ""); };
    byId("n-history").onclick = () => { this.openPanel("history"); this.setNav("n-history"); };
    byId("n-settings").onclick = () => { this.openPanel("settings"); this.setNav("n-settings"); };
    byId("n-image").onclick = () => { this.els.fileInput.click(); this.setNav("n-image"); };
    byId("n-nfc").onclick = () => { this.startNFC(); this.setNav("n-nfc"); };
    this.els.fileInput.onchange = (event) => this.scanImage(event);
    this.els.backdrop.onclick = () => this.closePanels();
    this.els.baBtn.onclick = () => this.els.bigAlert.classList.remove("on");
    this.els.bigAlert.onclick = (event) => { if (event.target.id === "big-alert") this.els.bigAlert.classList.remove("on"); };
    document.querySelectorAll("[data-close]").forEach((button) => { button.onclick = () => this.closePanels(); });
    document.querySelectorAll(".tab").forEach((tabButton) => { tabButton.onclick = () => this.filterList(tabButton.dataset.filter || "all"); });
    this.els.modeFull.onclick = () => this.setPiMode("FULL");
    this.els.modeShort.onclick = () => this.setPiMode("SHORT");
    this.els.profileSelect.onchange = (event) => {
      logic.settings.scanProfile = event.target.value;
      logic.saveSettings();
      this.updateProfileUi();
      this.status(`Profile active: ${this.getCurrentProfile().label}`);
      diag.info("profile.changed", { profileId: logic.settings.scanProfile });
    };
    this.els.batchToggle.onchange = () => this.toggleBatch();
    this.els.batchLayout.onchange = (event) => { this.batchLayout = event.target.value; };
    this.els.scriptUrl.onchange = () => { logic.settings.scriptUrl = this.els.scriptUrl.value.trim(); logic.saveSettings(); };
    this.els.ocrToggle.onchange = () => { logic.settings.ocrCorrection = this.els.ocrToggle.checked; logic.saveSettings(); };
    this.els.fullPrefix.onchange = () => { logic.settings.fullPrefix = this.els.fullPrefix.value.trim().toUpperCase(); logic.saveSettings(); };
    this.els.shortPrefix.onchange = () => { logic.settings.shortPrefix = this.els.shortPrefix.value.trim().toUpperCase(); logic.saveSettings(); };
    this.els.apiEnabled.onchange = () => { logic.settings.apiEnabled = this.els.apiEnabled.checked; logic.saveSettings(); this.updateApiUi(); };
    this.els.apiEndpoint.onchange = () => { logic.settings.apiEndpoint = this.els.apiEndpoint.value.trim(); logic.saveSettings(); };
    this.els.apiToken.onchange = () => { logic.settings.apiToken = this.els.apiToken.value.trim(); logic.saveSettings(); };
    this.els.apiTimeout.onchange = () => {
      const timeout = Number(this.els.apiTimeout.value || 4000);
      logic.settings.apiTimeoutMs = Number.isFinite(timeout) ? timeout : 4000;
      logic.saveSettings();
    };
    this.els.exportBtn.onclick = () => this.exportCSV();
    this.els.clearBtn.onclick = () => this.clearDB();
    this.els.refreshConfigBtn.onclick = () => this.refreshFirebaseConfig();
    this.els.testScanBtn.onclick = () => this.runTestScans();
    this.els.copyLogsBtn.onclick = () => this.copyLogs();
    this.els.clearLogsBtn.onclick = () => this.clearLogs();
    this.els.cmCancel.onclick = () => this.hideConfirmation();
    this.els.cmConfirm.onclick = () => { if (this.confirmCallback) this.confirmCallback(); };
    this.els.confirmModal.onclick = (event) => { if (event.target.id === "confirm-modal") this.hideConfirmation(); };
    window.addEventListener("online", () => { this.updateConnectionStatus(); this.startAutoSync(); });
    window.addEventListener("offline", () => { this.updateConnectionStatus(); this.stopAutoSync(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") this.closePanels(); });
  },
  applySettingsToUi() {
    this.els.fullPrefix.value = logic.settings.fullPrefix;
    this.els.shortPrefix.value = logic.settings.shortPrefix;
    this.els.ocrToggle.checked = !!logic.settings.ocrCorrection;
    this.els.scriptUrl.value = logic.settings.scriptUrl || "";
    this.els.batchToggle.checked = this.batchMode;
    this.els.batchLayout.value = this.batchLayout;
    this.els.apiEnabled.checked = !!logic.settings.apiEnabled;
    this.els.apiEndpoint.value = logic.settings.apiEndpoint || "";
    this.els.apiToken.value = logic.settings.apiToken || "";
    this.els.apiTimeout.value = String(logic.settings.apiTimeoutMs || 4000);
    this.els.profileSelect.innerHTML = this.profiles.map((profile) => `<option value="${profile.id}">${profile.label}</option>`).join("");
    if (!this.profiles.find((profile) => profile.id === logic.settings.scanProfile)) {
      logic.settings.scanProfile = "pi_full";
      logic.saveSettings();
    }
    this.els.profileSelect.value = logic.settings.scanProfile;
    this.updateProfileUi();
    this.updateApiUi();
    this.toggleBatch();
  },
  updateProfileUi() {
    const profile = this.getCurrentProfile();
    const isPi = profile.id === "pi_full" || profile.id === "pi_short";
    this.els.piModeGroup.classList.toggle("is-disabled", !isPi);
    this.els.modeFull.disabled = !isPi;
    this.els.modeShort.disabled = !isPi;
    this.els.modeFull.classList.toggle("on", logic.settings.scanProfile === "pi_full");
    this.els.modeShort.classList.toggle("on", logic.settings.scanProfile === "pi_short");
    this.els.modeTag.textContent = isPi ? `PI ${logic.settings.scanProfile === "pi_short" ? "SHORT" : "FULL"}` : profile.label;
    this.els.profileTag.textContent = profile.shortLabel;
  },
  updateApiUi() {
    const enabled = !!logic.settings.apiEnabled;
    this.els.apiEndpoint.disabled = !enabled;
    this.els.apiToken.disabled = !enabled;
    this.els.apiTimeout.disabled = !enabled;
  },
  initFirebase() {
    fbService.init((user) => {
      this.updateConnectionStatus();
      diag.info("auth.transition", { user: user?.uid || null, enabled: fbService.enabled, source: fbService.configSource });
      if (fbService.enabled && !user) {
        window.location.replace("./login.html");
        return;
      }
      if (this.canUseScanner() && this.scannerState !== "scanning") this.startScanner();
      this.startAutoSync();
    });
  },
  canUseScanner() { return !fbService.enabled || !!fbService.currentUser; },
  registerSW() { if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {}); },
  setNav(id) {
    document.querySelectorAll("#nav .n").forEach((button) => button.classList.toggle("on", button.id === id));
    if (id === "n-image") setTimeout(() => document.querySelectorAll("#nav .n").forEach((b) => b.classList.remove("on")), 500);
  },
  openPanel(id) {
    this.closePanels(false);
    const panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.add("on");
    panel.setAttribute("aria-hidden", "false");
    this.els.backdrop.classList.add("on");
    document.body.classList.add("panel-open");
    diag.info("panel.open", { panel: id });
  },
  closePanels(resetNav = true) {
    document.querySelectorAll(".panel.on").forEach((panel) => { panel.classList.remove("on"); panel.setAttribute("aria-hidden", "true"); diag.info("panel.close", { panel: panel.id }); });
    this.els.backdrop.classList.remove("on");
    document.body.classList.remove("panel-open");
    if (resetNav) this.setNav("");
  },
  status(text) { this.els.live.textContent = text; },
  toast(msg, type = "info", dur = 2200) {
    const container = document.getElementById("toast");
    const item = document.createElement("div");
    const icon = type === "success" ? "OK" : type === "warning" ? "!" : type === "error" ? "X" : "i";
    item.className = `t ${type}`;
    item.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add("show"));
    setTimeout(() => { item.classList.remove("show"); item.addEventListener("transitionend", () => item.remove(), { once: true }); }, dur);
  },
  feedback(type = "success") {
    const frame = document.getElementById("frame");
    const flash = document.getElementById("flash");
    frame.classList.remove("success", "warning", "error");
    frame.classList.add(type);
    if (type === "success") {
      flash.classList.add("on");
      setTimeout(() => flash.classList.remove("on"), 120);
      if (navigator.vibrate) navigator.vibrate(120);
      this.beep(940, 0.05);
    }
    if (type === "warning") {
      if (navigator.vibrate) navigator.vibrate([45, 40, 45]);
      this.beep(440, 0.05);
    }
    if (type === "error") this.beep(300, 0.08);
    setTimeout(() => frame.classList.remove("success", "warning", "error"), 420);
  },
  beep(freq, dur, type = "sine", vol = 0.02) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq; gain.gain.value = vol;
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start();
      setTimeout(() => { osc.stop(); audioCtx.close(); }, dur * 1000);
    } catch {}
  },
  async pauseScannerTemporarily(ms = this.pauseMs) {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    await this.stopScanner();
    this.restartTimer = setTimeout(() => { this.startScanner(); }, ms);
  },
  getCurrentProfile() { return this.profiles.find((p) => p.id === logic.settings.scanProfile) || this.profiles[0]; },
  getPiModeFromProfile(profileId) {
    if (profileId === "pi_short") return "SHORT";
    if (profileId === "pi_full") return "FULL";
    return "N/A";
  },
  setPiMode(mode) {
    logic.settings.scanProfile = mode === "SHORT" ? "pi_short" : "pi_full";
    logic.saveSettings();
    this.els.profileSelect.value = logic.settings.scanProfile;
    this.updateProfileUi();
  },
  toggleBatch() {
    this.batchMode = this.els.batchToggle.checked;
    this.els.batchLayout.disabled = !this.batchMode;
    if (!this.batchMode) this.batchCount = 0;
    this.updateMetrics();
  },
  updateMetrics() {
    const pending = this.scans.filter((scan) => scan.status === "pending").length;
    this.els.mTotal.textContent = `${this.scans.length} records`;
    this.els.mPending.textContent = `${pending} pending`;
    this.els.mBatch.textContent = this.batchMode ? `Batch ${this.batchCount}` : "Batch off";
  },
  async loadScans() {
    this.scans = await db.getAll();
    this.renderTypeFilterOptions();
    this.renderList(this.els.search?.value || "");
    this.updateMetrics();
    this.updateRecentScansFooter();
  },
  renderTypeFilterOptions() {
    const types = ["all", ...new Set(this.scans.map((scan) => scan.type || "UNKNOWN"))];
    const current = this.filterType;
    this.els.typeFilter.innerHTML = types.map((type) => `<option value="${type}">${type === "all" ? "All Types" : type}</option>`).join("");
    this.els.typeFilter.value = types.includes(current) ? current : "all";
    this.filterType = this.els.typeFilter.value;
  },
  updateRecentScansFooter() {
    const container = this.els.recent;
    if (!container) return;
    const recent = this.scans.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    container.innerHTML = "";
    if (!recent.length) { container.innerHTML = '<span class="recent-placeholder">Recent records...</span>'; return; }
    recent.forEach((scan) => {
      const el = document.createElement("span");
      el.className = "recent-item";
      el.textContent = `[${scan.type || "UNK"}] ${scan.code_normalized}`;
      container.appendChild(el);
    });
  },
  renderList(term = "") {
    const list = this.els.log;
    list.innerHTML = "";
    const filtered = this.scans
      .filter((scan) => (this.filter === "pending" ? scan.status === "pending" : this.filter === "sent" ? scan.status === "sent" : true))
      .filter((scan) => (this.filterType === "all" ? true : (scan.type || "UNKNOWN") === this.filterType))
      .filter((scan) => (scan.code_normalized || "").toLowerCase().includes(term.toLowerCase()))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No records to display.";
      list.appendChild(empty);
      return;
    }
    filtered.forEach((scan) => {
      const li = document.createElement("li");
      li.className = "item";
      const dt = new Date(scan.date).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const profileBadge = (scan.profileId || "legacy").replace(/_/g, "-").toUpperCase();
      li.innerHTML = `<div class="ih"><div class="code">${scan.code_normalized}</div><div class="time">${dt}</div></div><div class="meta"><span class="badge badge-type">${scan.type || "UNK"}</span><span class="badge badge-profile">${profileBadge}</span><span class="badge badge-${scan.status}">${scan.status}</span>${scan.used ? '<span class="badge badge-used">USED</span>' : ""}</div><div style="display:flex;justify-content:flex-end">${!scan.used ? `<button class="btn" data-used="${scan.id}">Mark used</button>` : ""}</div>`;
      list.appendChild(li);
    });
    list.querySelectorAll("[data-used]").forEach((button) => {
      button.onclick = async (event) => { event.stopPropagation(); await this.markUsed(Number(button.dataset.used)); };
    });
  },
  async markUsed(id) { await db.markUsed(id); await this.loadScans(); this.toast("Marked as used"); },
  filterList(type) {
    this.filter = type;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("on", tab.dataset.filter === type));
    this.renderList(this.els.search.value || "");
  },
  updateConnectionStatus() {
    const isOnline = navigator.onLine;
    this.els.offline.style.display = isOnline ? "none" : "inline";
    this.els.dot.classList.remove("offline", "warning");
    if (!isOnline) { this.els.dot.classList.add("offline"); this.status("No internet connection"); return; }
    if (!fbService.enabled) {
      this.els.dot.classList.add("warning");
      this.els.firebaseMode.textContent = "Local mode: Firebase not configured";
      this.disableSyncUi(true);
      return;
    }
    this.els.firebaseMode.textContent = `Firebase: ${fbService.configSource}`;
    this.disableSyncUi(!fbService.currentUser);
    if (!fbService.currentUser) { this.els.dot.classList.add("warning"); this.status("Waiting for authentication..."); }
    else this.status("Ready to scan");
  },
  disableSyncUi(disabled) {
    this.els.syncBtn.disabled = disabled;
    this.els.navSyncBtn.disabled = disabled;
    this.els.syncBtn.title = disabled ? "Sync unavailable in local mode" : "Sync";
    this.els.navSyncBtn.title = this.els.syncBtn.title;
  },
  showBigAlert(title, code, type) {
    this.els.baTitle.textContent = title;
    this.els.baCode.textContent = code;
    this.els.baIcon.textContent = type === "warning" ? "!" : "i";
    this.els.baBox.className = `ba-box ${type}`;
    this.els.bigAlert.classList.add("on");
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    this.beep(200, 0.3);
  },
  getApiSettings() {
    return { enabled: !!logic.settings.apiEnabled, endpoint: logic.settings.apiEndpoint, token: logic.settings.apiToken, timeoutMs: logic.settings.apiTimeoutMs };
  },
  async processScan(raw) {
    const profile = this.getCurrentProfile();
    const normalized = profile.normalize(raw);
    if (!profile.validate(normalized)) {
      this.status(`Invalid ${profile.shortLabel} code`);
      this.feedback("error");
      this.toast(`Invalid format for ${profile.label}`, "warning");
      return { ok: false };
    }
    const duplicate = this.scans.find((scan) => scan.code_normalized === normalized && scan.profileId === profile.id);
    if (duplicate) {
      this.status("Duplicate code");
      this.feedback("warning");
      this.showBigAlert("DUPLICATE", normalized, "warning");
      return { ok: false, duplicate: true };
    }
    const record = {
      code_original: String(raw || "").trim(), code_normalized: normalized,
      profileId: profile.id, type: profile.type, pi_mode: this.getPiModeFromProfile(profile.id),
      layout: this.batchMode ? this.batchLayout : "QWERTY", date: new Date().toISOString(),
      used: false, dateUsed: null, status: "pending", apiResult: null,
    };
    await db.addScan(record);
    await this.loadScans();
    if (profile.id === "api" && typeof profile.apiAction === "function") {
      const apiResult = await profile.apiAction(normalized, this.getApiSettings());
      this.els.apiResponse.textContent = apiResult.ok ? `API OK (${apiResult.status}) ${apiResult.body || ""}` : `API FAIL (${apiResult.reason || apiResult.status || "error"})`;
      this.toast(apiResult.ok ? "API request succeeded" : "API request failed", apiResult.ok ? "success" : "warning", 2600);
      diag.info("api.scan.result", apiResult);
    }
    return { ok: true, normalized, profile };
  },
  async onScan(raw) {
    if (this.isHandling) return;
    const now = Date.now();
    if (raw === this.lastCode && now - this.lastAt < 1200) return;
    this.lastCode = raw;
    this.lastAt = now;
    this.isHandling = true;
    try {
      const result = await this.processScan(raw);
      if (!result.ok) { await this.pauseScannerTemporarily(result.duplicate ? 2000 : 800); return; }
      this.batchCount += this.batchMode ? 1 : 0;
      this.updateMetrics();
      this.status(`Saved (${result.profile.shortLabel}): ${result.normalized}`);
      this.feedback("success");
      this.toast(`Saved ${result.normalized}`, "success");
      await this.pauseScannerTemporarily();
    } catch (error) {
      diag.error("scan.handle_failed", { message: error?.message || String(error) });
      this.status("Scan processing error");
      this.toast("Scan processing failed", "error", 2800);
    } finally {
      this.isHandling = false;
    }
  },
  startAutoSync() {
    if (!fbService.enabled || !fbService.currentUser || this.syncIntervalId || !navigator.onLine) return;
    this.syncIntervalId = setInterval(async () => { if (navigator.onLine) await this.runFullSync(true); }, 15000);
  },
  stopAutoSync() {
    if (!this.syncIntervalId) return;
    clearInterval(this.syncIntervalId);
    this.syncIntervalId = null;
  },
  async runFullSync(silent = false) {
    if (!fbService.enabled) { if (!silent) this.toast("Local mode: sync disabled", "warning"); return; }
    if (!fbService.currentUser) { if (!silent) this.toast("Login required for sync", "warning"); return; }
    const top = this.els.syncBtn, nav = this.els.navSyncBtn;
    if (top.disabled) return;
    top.disabled = true; nav.disabled = true;
    top.classList.add("syncing"); nav.classList.add("syncing");
    this.status("Syncing...");
    diag.info("sync.start", { silent });
    if (!silent) this.toast("Syncing", "info", 1400);
    try {
      const pending = this.scans.filter((scan) => scan.status === "pending");
      const result = await fbService.syncScans(pending);
      if (result.pushedCount > 0) {
        for (const item of pending) await db.updateStatus(item.id, "sent");
      }
      const merged = await this.merge(result.serverScans);
      this.status(`Sync complete${merged ? ` (${merged} new)` : ""}`);
      if (!silent) this.toast(`Sync complete${merged ? `: ${merged} new` : ""}`, "success");
      diag.info("sync.end", { pushed: result.pushedCount, merged });
    } catch (error) {
      diag.error("sync.error", { message: error?.message || String(error) });
      this.status("Sync failed");
      if (!silent) this.toast(error.message || "Sync error", "error", 2800);
    } finally {
      top.classList.remove("syncing"); nav.classList.remove("syncing");
      this.updateConnectionStatus();
      await this.loadScans();
    }
  },
  async merge(serverScans) {
    const localKeys = new Set(this.scans.map((scan) => `${scan.profileId || "legacy"}::${scan.code_normalized}`));
    let added = 0;
    for (const scan of serverScans) {
      const key = `${scan.profileId || "legacy"}::${scan.code_normalized}`;
      if (!scan.code_normalized || localKeys.has(key)) continue;
      await db.addScan({
        code_original: scan.code_original || scan.code_normalized,
        code_normalized: scan.code_normalized,
        profileId: scan.profileId || "legacy",
        type: scan.type || "UNK",
        pi_mode: scan.pi_mode || "N/A",
        layout: scan.layout || "UNKNOWN",
        date: scan.date || new Date().toISOString(),
        used: !!scan.used,
        dateUsed: scan.dateUsed || null,
        status: "sent",
      });
      added += 1;
    }
    return added;
  },
  async scanImage(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    this.toast("Scanning image", "info", 1500);
    try {
      await this.stopScanner();
      const temp = new Html5Qrcode("reader");
      const decoded = await temp.scanFile(file, true);
      await this.onScan(decoded);
      await temp.clear();
    } catch {
      this.toast("No code detected in image", "warning", 2400);
    } finally {
      event.target.value = "";
      if (this.canUseScanner()) await this.startScanner();
      this.setNav("");
    }
  },
  async startNFC() {
    if (!("NDEFReader" in window)) { this.toast("NFC not supported", "error"); return; }
    try {
      const reader = new NDEFReader();
      await reader.scan();
      this.toast("Bring NFC tag near device", "info");
      reader.onreading = (event) => {
        if (event.message && event.message.records) {
          for (const record of event.message.records) {
            if (record.recordType === "text") {
              try {
                const langLength = record.data.getUint8(0) & 63;
                const text = new TextDecoder(record.encoding).decode(new DataView(record.data.buffer, record.data.byteOffset + 1 + langLength, record.data.byteLength - 1 - langLength));
                this.onScan(text);
                return;
              } catch {}
            }
          }
        }
        if (event.serialNumber) this.onScan(event.serialNumber.replace(/:/g, "").toUpperCase());
      };
      reader.onreadingerror = () => this.toast("NFC read error", "error");
    } catch (error) {
      this.toast(`NFC error: ${error}`, "error");
    }
  },
  exportCSV() {
    const headers = ["ID", "Code", "Type", "ProfileId", "PiMode", "Layout", "Date", "Status", "Used"];
    const rows = this.scans.map((scan) => [scan.id, scan.code_normalized, scan.type || "", scan.profileId || "", scan.pi_mode || "", scan.layout || "", scan.date, scan.status, scan.used]);
    const csv = [headers.join(","), ...rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `barra_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.toast("CSV exported", "success");
  },
  async clearDB() {
    this.showConfirmation({
      title: "Clear History",
      message: "This action cannot be undone and removes all local records. Continue?",
      icon: "!",
      confirmText: "Yes, clear",
      onConfirm: async () => {
        await db.clear();
        this.batchCount = 0;
        await this.loadScans();
        this.toast("History cleared", "success");
        this.hideConfirmation();
      },
    });
  },
  refreshFirebaseConfig() {
    this.showConfirmation({
      title: "Refresh Firebase Config",
      message: "Cached config will be removed and the app will reload.",
      icon: "i",
      confirmText: "Refresh",
      onConfirm: () => {
        localStorage.removeItem("firebase_config_cache");
        this.toast("Config cache cleared. Reloading...", "info", 1500);
        setTimeout(() => window.location.reload(), 1500);
      },
    });
  },
  runTestScans() {
    const uniqueSuffix = Date.now().toString().slice(-5);
    const samples = this.profiles.map((profile) => {
      const value = profile.sample();
      if (profile.id === "test" || profile.id === "api") return `${value}-${uniqueSuffix}`;
      return value;
    });
    this.showConfirmation({
      title: "Insert test scans",
      message: "Sample scan for each profile will be saved locally.",
      icon: "T",
      confirmText: "Run",
      onConfirm: async () => {
        this.hideConfirmation();
        for (let i = 0; i < this.profiles.length; i += 1) {
          const profile = this.profiles[i];
          logic.settings.scanProfile = profile.id;
          this.els.profileSelect.value = profile.id;
          this.updateProfileUi();
          await this.processScan(samples[i]);
        }
        logic.settings.scanProfile = "pi_full";
        this.els.profileSelect.value = "pi_full";
        this.updateProfileUi();
        logic.saveSettings();
        this.toast("Test scans inserted", "success", 2600);
      },
    });
  },
  async copyLogs() {
    const text = diag.getText() || "No logs yet.";
    try { await navigator.clipboard.writeText(text); this.toast("Logs copied", "success"); }
    catch { this.toast("Could not copy logs", "error"); }
  },
  clearLogs() { diag.clear(); this.toast("Logs cleared", "success"); },
  showConfirmation({ title, message, icon = "?", confirmText = "Confirm", onConfirm }) {
    this.els.cmTitle.textContent = title;
    this.els.cmMessage.textContent = message;
    this.els.cmIcon.textContent = icon;
    this.els.cmConfirm.textContent = confirmText;
    this.confirmCallback = onConfirm;
    this.els.confirmModal.classList.add("on");
  },
  hideConfirmation() { this.els.confirmModal.classList.remove("on"); this.confirmCallback = null; },
  async stopScanner() {
    if (!this.scanner || this.scannerState !== "scanning") return;
    try { await this.scanner.stop(); } catch {}
    this.scannerState = "stopped";
    diag.info("scanner.stop");
  },
  async startScanner() {
    if (!this.canUseScanner()) return;
    if (!("Html5Qrcode" in window)) { this.status("Scanner library unavailable"); return; }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.scannerState === "scanning") return;
    if (!this.scanner) this.scanner = new Html5Qrcode("reader", { verbose: false });
    const config = { fps: 10, aspectRatio: 1.7777778 };
    this.status("Starting camera");
    diag.info("scanner.start_attempt");
    try {
      await this.scanner.start({ facingMode: { exact: "environment" } }, config, (decoded) => this.onScan(decoded), () => {});
      this.scannerState = "scanning";
      this.status("Ready to scan");
      return;
    } catch {}
    try {
      await this.scanner.start({ facingMode: "environment" }, config, (decoded) => this.onScan(decoded), () => {});
      this.scannerState = "scanning";
      this.status("Ready to scan");
      return;
    } catch {}
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras?.length) throw new Error("No camera found");
      const back = cameras.find((camera) => {
        const label = String(camera.label || "").toLowerCase();
        return label.includes("back") || label.includes("rear") || label.includes("trase") || label.includes("environment");
      });
      await this.scanner.start((back || cameras[0]).id, config, (decoded) => this.onScan(decoded), () => {});
      this.scannerState = "scanning";
      this.status("Ready to scan");
    } catch (error) {
      this.scannerState = "error";
      this.status("Could not open camera");
      this.toast("Could not start camera", "error", 3000);
      diag.error("scanner.start_failed", { message: error?.message || String(error) });
    }
  },
};

document.addEventListener("DOMContentLoaded", () => {
  app.init().catch((error) => {
    diag.error("boot.failed", { message: error?.message || String(error) });
    const shell = document.querySelector(".app-shell");
    const loader = document.getElementById("app-loader");
    if (shell) shell.style.display = "block";
    if (loader) { loader.style.opacity = "0"; setTimeout(() => loader.remove(), 320); }
    const live = document.getElementById("live");
    if (live) live.textContent = "Initialization failed. Check diagnostics logs.";
  });
});

window.app = app;
