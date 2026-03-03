import { fbService } from "./firebase-service.js";

// --- DB MODULE (IndexedDB Wrapper) ---
const db = {
    dbName: "BarraScannerDB", version: 1, instance: null,
    init() {
        return new Promise((r, j) => {
            const q = indexedDB.open(this.dbName, this.version);
            q.onupgradeneeded = e => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains("scans")) {
                    const s = d.createObjectStore("scans", { keyPath: "id", autoIncrement: true });
                    s.createIndex("code_normalized", "code_normalized", { unique: false });
                    s.createIndex("status", "status", { unique: false });
                }
            };
            q.onsuccess = e => { this.instance = e.target.result; r(this.instance) };
            q.onerror = e => j(e)
        })
    },
    addScan(x) {
        return new Promise((r, j) => {
            const t = this.instance.transaction(["scans"], "readwrite");
            const q = t.objectStore("scans").add(x);
            q.onsuccess = () => r(q.result);
            q.onerror = () => j(q.error)
        })
    },
    getAll() {
        return new Promise(r => {
            const q = this.instance.transaction(["scans"], "readonly").objectStore("scans").getAll();
            q.onsuccess = () => r(q.result || [])
        })
    },
    async updateStatus(id, status) {
        const t = this.instance.transaction(["scans"], "readwrite").objectStore("scans");
        const item = await new Promise(r => { const q = t.get(id); q.onsuccess = e => r(e.target.result) });
        if (item) { item.status = status; t.put(item) }
    },
    async markUsed(id) {
        const t = this.instance.transaction(["scans"], "readwrite").objectStore("scans");
        const item = await new Promise(r => { const q = t.get(id); q.onsuccess = e => r(e.target.result) });
        if (item) { item.used = true; item.dateUsed = new Date().toISOString(); t.put(item) }
    },
    clear() {
        return new Promise(r => {
            const t = this.instance.transaction(["scans"], "readwrite");
            t.objectStore("scans").clear();
            t.oncomplete = r
        })
    }
};

// --- LOGIC MODULE ---
const logic = {
    settings: { fullPrefix: "02PI20", shortPrefix: "MUSTBRUN", ocrCorrection: true, scriptUrl: "", theme: "midnight" }, // scriptUrl deprecated but kept for compatibility
    applyTheme(theme) {
        const validThemes = new Set(["midnight", "sunset", "forest", "ice"]);
        const selected = validThemes.has(theme) ? theme : "midnight";
        document.documentElement.setAttribute("data-theme", selected);
        const themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) {
            const colorByTheme = {
                midnight: "#0d1117",
                sunset: "#1a1212",
                forest: "#0d1712",
                ice: "#10161f"
            };
            themeMeta.setAttribute("content", colorByTheme[selected] || colorByTheme.midnight);
        }
    },
    loadSettings() {
        const s = localStorage.getItem("barra_settings");
        if (s) this.settings = { ...this.settings, ...JSON.parse(s) };
        document.getElementById("full-prefix").value = this.settings.fullPrefix;
        document.getElementById("short-prefix").value = this.settings.shortPrefix;
        document.getElementById("ocr-toggle").checked = this.settings.ocrCorrection;
        const themeSelect = document.getElementById("theme-select");
        if (themeSelect) themeSelect.value = this.settings.theme || "midnight";
        this.applyTheme(this.settings.theme);
    },
    saveSettings() {
        this.settings.fullPrefix = document.getElementById("full-prefix").value.trim();
        this.settings.shortPrefix = document.getElementById("short-prefix").value.trim();
        this.settings.ocrCorrection = document.getElementById("ocr-toggle").checked;
        const themeSelect = document.getElementById("theme-select");
        if (themeSelect) this.settings.theme = themeSelect.value;
        this.applyTheme(this.settings.theme);
        localStorage.setItem("barra_settings", JSON.stringify(this.settings))
    },
    normalize(code) {
        let c = (code || "").trim().toUpperCase().replace(/\s+/g, "");
        if (this.settings.ocrCorrection) c = c.replace(/O/g, "0");
        return c
    },
    convert(code, targetMode) {
        const c = this.normalize(code), f = this.settings.fullPrefix, s = this.settings.shortPrefix, isFull = c.startsWith(f), isShort = c.startsWith(s) || (!isFull && /^[A-Z0-9]+$/.test(c));
        if (targetMode === "SHORT") {
            if (isShort) return c;
            if (isFull) { const core = c.substring(f.length, c.length - 2); return s + core }
        } else {
            if (isFull) return c;
            if (isShort) { let core = c; if (c.startsWith(s)) core = c.substring(s.length); return f + core + "00" }
        }
        return null
    },
    validate(code, mode) {
        const c = this.normalize(code);
        if (c.length < 5) return false;
        if (mode === "FULL" && !c.startsWith(this.settings.fullPrefix)) return false;
        return true
    }
};

// --- APP MODULE ---
const app = {
    mode: "FULL", scans: [], tempScan: null, filter: "all", scanner: null, scannerState: "idle", batchMode: false, batchCount: 0, batchLayout: "QWERTY", syncIntervalId: null, isHandling: false, lastCode: "", lastAt: 0, restartTimer: null, pauseMs: 1300, appInitialized: false, confirmCallback: null,
    
    async init(user) {
        // The main auth guard has already run. We are definitely authenticated here.
        if (this.appInitialized) return;
        this.appInitialized = true;

        // Set up a listener for subsequent auth changes (e.g., user logs out).
        fbService.init(async (currentUser) => {
            this.updateConnectionStatus();
            if (!currentUser && fbService.enabled) {
                // The user has logged out from this or another tab.
                await this.stopScanner(); // Cleanly stop camera before redirecting.
                window.location.replace('./login.html');
            }
        });

        // Proceed with initializing the app UI and services.
        await db.init();
        logic.loadSettings();
        this.bind();
        await this.loadScans();
        this.registerSW();

        const userDisplay = document.getElementById("user-display-name");
        const avatar = document.getElementById("user-avatar-img");
        userDisplay.textContent = fbService.getUserDisplay();
        avatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${userDisplay.textContent}&background=random`;
        
        this.startScanner();
        this.startAutoSync();
        this.updateConnectionStatus();
    },

    bind() {
        const $ = id => document.getElementById(id);
        $("sync-btn").onclick = () => this.runFullSync();
        $("n-sync").onclick = () => this.runFullSync();
        $("search").oninput = e => this.renderList(e.target.value);
        $("n-history").onclick = () => { this.show("history"); this.setNav("n-history") };
        $("n-settings").onclick = () => { this.show("settings"); this.setNav("n-settings") };
        $("n-image").onclick = () => { $("file").click(); this.setNav("n-image") };
        $("n-nfc").onclick = () => { this.startNFC(); this.setNav("n-nfc") };
        $("file").onchange = e => this.scanImage(e);
        $("backdrop").onclick = () => this.close();
        $("ba-btn").onclick = () => document.getElementById("big-alert").classList.remove("on");
        $("big-alert").onclick = (e) => { if (e.target.id === "big-alert") document.getElementById("big-alert").classList.remove("on") };
        document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => this.close());
        document.querySelectorAll(".tab").forEach(t => t.onclick = () => this.filterList(t.dataset.filter || "all"));
        $("mode-full").onclick = () => this.setMode("FULL");
        $("mode-short").onclick = () => this.setMode("SHORT");
        $("batch-toggle").onchange = () => this.toggleBatch();
        $("batch-layout").onchange = e => this.batchLayout = e.target.value;
        document.querySelectorAll(".input,.select").forEach(el => { el.onchange = () => logic.saveSettings(); el.onblur = () => logic.saveSettings() });
        $("ocr-toggle").onchange = () => logic.saveSettings();
        $("theme-select").onchange = () => logic.saveSettings();
        $("export-btn").onclick = () => this.exportCSV();
        $("clear-btn").onclick = () => this.clearDB();
        $("clear-cache-btn").onclick = () => this.clearCacheAndReload();
        $("logout-btn").onclick = () => fbService.logout();

        // Listeners para el nuevo modal de confirmación
        const confirmModal = document.getElementById('confirm-modal');
        document.getElementById('cm-cancel-btn').onclick = () => this.hideConfirmation();
        document.getElementById('cm-confirm-btn').onclick = () => {
            if (this.confirmCallback) {
                this.confirmCallback();
            }
        };
        if (confirmModal) {
            confirmModal.onclick = (e) => { if (e.target.id === 'confirm-modal') this.hideConfirmation(); };
        }

        window.addEventListener("online", () => { this.updateConnectionStatus(); this.startAutoSync() });
        window.addEventListener("offline", () => { this.updateConnectionStatus(); this.stopAutoSync() })
    },
    registerSW() { if ("serviceWorker" in navigator) { navigator.serviceWorker.register("./sw.js").catch(() => { }) } },
    setNav(id) { document.querySelectorAll("#nav .n").forEach(b => b.classList.toggle("on", b.id === id)); if (id === "n-image") setTimeout(() => document.querySelectorAll("#nav .n").forEach(b => b.classList.remove("on")), 500) },
    status(text) { document.getElementById("live").textContent = text },
    updateMetrics() { const p = this.scans.filter(s => s.status === "pending").length; document.getElementById("m-total").textContent = `${this.scans.length} records`; document.getElementById("m-pending").textContent = `${p} pending`; document.getElementById("m-batch").textContent = this.batchMode ? `Batch ${this.batchCount}` : "Batch off" },
    show(id) { this.close(false); const p = document.getElementById(id); p.classList.add("on"); p.setAttribute("aria-hidden", "false"); document.getElementById("backdrop").classList.add("on") },
    close(reset = true) { document.querySelectorAll(".panel.on").forEach(p => { p.classList.remove("on"); p.setAttribute("aria-hidden", "true") }); document.getElementById("backdrop").classList.remove("on"); if (reset) this.setNav("") },
    toggleBatch() { this.batchMode = document.getElementById("batch-toggle").checked; document.getElementById("batch-layout").disabled = !this.batchMode; if (!this.batchMode) this.batchCount = 0; this.updateMetrics() },
    setMode(m) { this.mode = m; document.getElementById("mode-full").classList.toggle("on", m === "FULL"); document.getElementById("mode-short").classList.toggle("on", m === "SHORT"); document.getElementById("mode-tag").textContent = `${m} MODE`; this.status(`${m} mode active`) },
    toast(msg, type = "info", dur = 2200) { const c = document.getElementById("toast"), t = document.createElement("div"), ic = type === "success" ? "✓" : type === "warning" ? "!" : type === "error" ? "✕" : "•"; t.className = `t ${type}`; t.innerHTML = `<span>${ic}</span><span>${msg}</span>`; c.appendChild(t); requestAnimationFrame(() => t.classList.add("show")); setTimeout(() => { t.classList.remove("show"); t.addEventListener("transitionend", () => t.remove(), { once: true }) }, dur) },
    feedback(type = "success") { const f = document.getElementById("frame"), flash = document.getElementById("flash"); f.classList.remove("success", "warning", "error"); f.classList.add(type); if (type === "success") { flash.classList.add("on"); setTimeout(() => flash.classList.remove("on"), 120); if (navigator.vibrate) navigator.vibrate(120); this.beep(940, .05) } if (type === "warning") { if (navigator.vibrate) navigator.vibrate([45, 40, 45]); this.beep(440, .05) } if (type === "error") this.beep(300, .08); setTimeout(() => f.classList.remove("success", "warning", "error"), 420) },
    beep(freq, dur, type = "sine", vol = 0.02) { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close() }, dur * 1000) } catch (_) { } },
    async pauseScannerTemporarily(ms = this.pauseMs) { if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null } await this.stopScanner(); this.restartTimer = setTimeout(() => { this.startScanner() }, ms) },
    async loadScans() { this.scans = await db.getAll(); this.renderList(document.getElementById("search")?.value || ""); this.updateMetrics(); this.updateRecentScansFooter() },
    updateRecentScansFooter() { const c = document.getElementById("recent-scans-container"); if (!c) return; const r = this.scans.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8); c.innerHTML = ""; if (r.length === 0) { c.innerHTML = '<span class="recent-placeholder">Recent records...</span>'; return } r.forEach(s => { const e = document.createElement("span"); e.className = "recent-item"; e.textContent = s.code_normalized; c.appendChild(e) }) },
    renderList(term = "") { const list = document.getElementById("log"); list.innerHTML = ""; const f = this.scans.filter(s => this.filter === "pending" ? s.status === "pending" : this.filter === "sent" ? s.status === "sent" : true).filter(s => (s.code_normalized || "").toLowerCase().includes(term.toLowerCase())).sort((a, b) => new Date(b.date) - new Date(a.date)); if (!f.length) { const d = document.createElement("div"); d.className = "item"; d.textContent = "No records to show."; list.appendChild(d); return } f.forEach(scan => { const li = document.createElement("li"); li.className = "item"; const dt = new Date(scan.date).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); li.innerHTML = `<div class="ih"><div class="code">${scan.code_normalized}</div><div class="time">${dt}</div></div><div class="meta"><span class="badge badge-${String(scan.pi_mode || "SHORT").toLowerCase()}">${scan.pi_mode || "UNK"}</span><span class="badge badge-${scan.status}">${scan.status}</span>${scan.used ? '<span class="badge badge-used">USED</span>' : ''}</div><div style="display:flex;justify-content:flex-end">${!scan.used ? `<button class="btn" data-used="${scan.id}">Mark used</button>` : ""}</div>`; list.appendChild(li) }); list.querySelectorAll("[data-used]").forEach(b => b.onclick = async e => { e.stopPropagation(); await this.markUsed(Number(b.dataset.used)) }) },
    async markUsed(id) { await db.markUsed(id); await this.loadScans(); this.toast("Marked as used") },
    filterList(type) { this.filter = type; document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.filter === type)); this.renderList(document.getElementById("search").value || "") },
    updateConnectionStatus() {
        const dot = document.getElementById("dot");
        const offlineIndicator = document.getElementById("offline");
        const isOnline = navigator.onLine;

        offlineIndicator.style.display = isOnline ? "none" : "inline";
        dot.classList.remove("offline", "warning"); // Reinicia clases de estado

        if (!isOnline) {
            dot.classList.add("offline"); // Rojo si no hay internet
            this.status("No internet connection");
        } else if (!fbService.enabled || !fbService.currentUser) {
            dot.classList.add("warning"); // Amarillo si hay internet pero no Firebase
            if (!fbService.enabled) {
                this.status("Error: Firebase not configured.");
            } else {
                this.status("Connecting to Firebase...");
            }
        }
        // Si está online y con usuario de Firebase, el punto será verde por defecto (sin clases extra)
    },
    showBigAlert(title, code, type) { const el = document.getElementById("big-alert"); const box = document.getElementById("ba-box"); document.getElementById("ba-title").textContent = title; document.getElementById("ba-code").textContent = code; document.getElementById("ba-icon").textContent = type === "warning" ? "⚠️" : "ℹ️"; box.className = "ba-box " + type; el.classList.add("on"); if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]); this.beep(200, 0.3) },
    onScan(raw) { if (this.isHandling) return; const now = Date.now(); if (raw === this.lastCode && now - this.lastAt < 1200) return; this.lastCode = raw; this.lastAt = now; this.isHandling = true; const n = logic.normalize(raw); let finalCode = logic.convert(n, this.mode); if (!finalCode) finalCode = n; if (!logic.validate(finalCode, this.mode)) { this.status(`Invalid code (${this.mode})`); this.feedback("error"); this.toast(`Invalid format for ${this.mode}`, "warning"); this.pauseScannerTemporarily(800).finally(() => { this.isHandling = false }); return } const dup = this.scans.find(s => s.code_normalized === finalCode); if (dup) { this.status("Duplicate code"); this.feedback("warning"); this.showBigAlert("DUPLICATE", finalCode, "warning"); this.pauseScannerTemporarily(2000).finally(() => { this.isHandling = false }); return } this.tempScan = finalCode; if (this.batchMode) { this.confirm(this.batchLayout).finally(async () => { this.batchCount++; this.updateMetrics(); this.status(`Saved in batch: ${finalCode}`); this.feedback("success"); await this.pauseScannerTemporarily(); this.isHandling = false }); return } this.confirm("QWERTY").finally(async () => { this.status(`Saved: ${finalCode}`); this.feedback("success"); await this.pauseScannerTemporarily(); this.isHandling = false }) },
    async confirm(layout) { const r = { code_original: this.tempScan, code_normalized: this.tempScan, pi_mode: this.mode, layout, date: new Date().toISOString(), used: false, dateUsed: null, status: "pending" }; await db.addScan(r); await this.loadScans(); this.toast(`Saved ${this.tempScan}`, "success") },

    // --- SYNC LOGIC UPDATED FOR FIREBASE ---
    startAutoSync() { if (this.syncIntervalId || !navigator.onLine) return; this.syncIntervalId = setInterval(async () => { if (navigator.onLine) await this.runFullSync(true) }, 15000) },
    stopAutoSync() { if (!this.syncIntervalId) return; clearInterval(this.syncIntervalId); this.syncIntervalId = null },

    async runFullSync(silent = false) {
        const a = document.getElementById("sync-btn"), b = document.getElementById("n-sync");
        if (a.disabled) return;

        a.disabled = true;
        b.disabled = true;
        a.classList.add('syncing');
        b.classList.add('syncing');
        this.status("Syncing...");
        if (!silent) this.toast("Syncing", "info", 1400);

        try {
            const pending = this.scans.filter(s => s.status === "pending");

            // Usar el servicio de Firebase
            const result = await fbService.syncScans(pending);

            // Actualizar locales a "sent"
            if (result.pushedCount > 0) {
                for (const item of pending) await db.updateStatus(item.id, "sent");
            }

            // Merge de datos del servidor
            const merged = await this.merge(result.serverScans);

            this.status(`Sync complete${merged ? ` (${merged} new)` : ""}`);
            if (!silent) this.toast(`Sync ready${merged ? `: ${merged} new` : ""}`, "success");
        } catch (e) {
            console.error(e);
            this.status("Sync error");
            if (!silent) this.toast(e.message || "Sync error", "error", 2800);
        } finally {
            a.disabled = false;
            b.disabled = false;
            a.classList.remove('syncing');
            b.classList.remove('syncing');
            await this.loadScans();
        }
    },

    async merge(serverScans) {
        const localCodes = new Set(this.scans.map(s => s.code_normalized));
        let add = 0;
        for (const s of serverScans) {
            if (s.code_normalized && !localCodes.has(s.code_normalized)) {
                await db.addScan({
                    code_original: s.code_original || s.code_normalized,
                    code_normalized: s.code_normalized,
                    pi_mode: s.pi_mode || "UNKNOWN",
                    layout: s.layout || "UNKNOWN",
                    date: s.date || new Date().toISOString(),
                    used: s.used || false,
                    dateUsed: s.dateUsed || null,
                    status: "sent" // Vienen del server, así que están sent
                });
                add++;
            }
        }
        return add;
    },

    async scanImage(event) { const file = event?.target?.files?.[0]; if (!file) return; this.toast("Scanning image", "info", 1500); try { await this.stopScanner(); const h = new Html5Qrcode("reader"); const decoded = await h.scanFile(file, true); this.onScan(decoded); await h.clear() } catch (_) { this.toast("No code detected in image", "warning", 2400) } finally { event.target.value = ""; await this.startScanner(); this.setNav("") } },
    async startNFC() { if (!("NDEFReader" in window)) { this.toast("NFC not supported", "error"); return } try { const n = new NDEFReader(); await n.scan(); this.toast("Bring badge closer...", "info"); n.onreading = e => { if (e.message && e.message.records) { for (const r of e.message.records) { if (r.recordType === "text") { try { const l = r.data.getUint8(0) & 63; const t = new TextDecoder(r.encoding).decode(new DataView(r.data.buffer, r.data.byteOffset + 1 + l, r.data.byteLength - 1 - l)); this.onScan(t); return } catch (_) { } } } } if (e.serialNumber) this.onScan(e.serialNumber.replace(/:/g, "").toUpperCase()) }; n.onreadingerror = () => this.toast("NFC reading error", "error") } catch (e) { this.toast("NFC Error: " + e, "error") } },
    exportCSV() { const h = ["ID", "Code", "Mode", "Layout", "Date", "Status", "Used"], rows = this.scans.map(s => [s.id, s.code_normalized, s.pi_mode, s.layout, s.date, s.status, s.used]), csv = [h.join(","), ...rows.map(r => r.join(","))].join("\n"), blob = new Blob([csv], { type: "text/csv" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `barra_export_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url); this.toast("CSV exported", "success") },
    async clearDB() {
        this.showConfirmation({
            title: 'Clear History',
            message: 'This action is irreversible and will delete all records saved on this device. Are you sure?',
            icon: '🗑️',
            confirmText: 'Yes, clear',
            onConfirm: async () => {
                await db.clear();
                this.batchCount = 0;
                await this.loadScans();
                this.toast("History cleared", "success");
                this.hideConfirmation();
            }
        });
    },
    async clearCacheAndReload() {
        this.showConfirmation({
            title: 'Clear Cache',
            message: 'This will force a reload of all application files. Useful if the app is not working correctly. Continue?',
            icon: '🧹',
            confirmText: 'Yes, clear',
            onConfirm: async () => {
                this.hideConfirmation();
                this.toast("Clearing cache and Service Worker...", "info", 4000);
                try {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const registration of registrations) {
                        await registration.unregister();
                    }
                    const cacheKeys = await caches.keys();
                    await Promise.all(cacheKeys.map(key => caches.delete(key)));

                    this.toast("Cleanup complete. Reloading...", "success", 2000);
                    setTimeout(() => { window.location.reload(); }, 1500);
                } catch (error) {
                    console.error("Error al limpiar la caché:", error);
                    this.toast("Error clearing cache", "error");
                }
            }
        });
    },
    showConfirmation({ title, message, icon = '?', confirmText = 'Confirmar', onConfirm }) {
        const modal = document.getElementById('confirm-modal');
        document.getElementById('cm-title').textContent = title;
        document.getElementById('cm-message').textContent = message;
        document.getElementById('cm-icon').textContent = icon;
        document.getElementById('cm-confirm-btn').textContent = confirmText;
        this.confirmCallback = onConfirm;
        modal.classList.add('on');
    },
    hideConfirmation() {
        document.getElementById('confirm-modal').classList.remove('on');
        this.confirmCallback = null;
    },
    async stopScanner() { if (!this.scanner || this.scannerState !== "scanning") return; try { await this.scanner.stop(); this.scannerState = "stopped" } catch (_) { this.scannerState = "stopped" } },
    async startScanner() { if (!fbService.currentUser) return; if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null } if (this.scannerState === "scanning") return; if (!this.scanner) this.scanner = new Html5Qrcode("reader", { verbose: false }); const cfg = { fps: 10, aspectRatio: 1.7777778 }; this.status("Starting camera"); try { await this.scanner.start({ facingMode: { exact: "environment" } }, cfg, d => this.onScan(d), () => { }); this.scannerState = "scanning"; this.status("Ready to scan"); return } catch (_) { } try { await this.scanner.start({ facingMode: "environment" }, cfg, d => this.onScan(d), () => { }); this.scannerState = "scanning"; this.status("Ready to scan"); return } catch (_) { } try { const cams = await Html5Qrcode.getCameras(); if (!cams?.length) throw new Error("No cameras"); const back = cams.find(c => { const l = String(c.label || "").toLowerCase(); return l.includes("back") || l.includes("rear") || l.includes("trase") || l.includes("environment") }); await this.scanner.start((back || cams[0]).id, cfg, d => this.onScan(d), () => { }); this.scannerState = "scanning"; this.status("Ready to scan") } catch (err) { this.scannerState = "error"; this.status("Could not open camera"); this.toast("Could not start camera", "error", 3000); console.error(err) } }
};

/**
 * Main application entry point. Acts as an asynchronous auth guard.
 */
async function main() {
    try {
        // 1. Check Auth State (UI is hidden behind loader)
        const user = await fbService.getInitialUser();

        if (!user) {
            // User is not authenticated. Redirect to the login page.
            if (fbService.enabled) {
                window.location.replace('./login.html');
            } else {
                // Handle case where Firebase is not configured/enabled.
                document.body.innerHTML = `<div style="padding: 2em; text-align: center; color: white;"><h1>Configuration Error</h1><p>Firebase is not available. The application cannot continue.</p></div>`;
            }
            return; // Stop execution for this page.
        }

        // 2. User is authenticated. Initialize App Logic.
        await app.init(user);

        // 3. Reveal the App UI and remove Loader
        const shell = document.querySelector(".app-shell");
        const loader = document.getElementById("app-loader");
        
        if (shell) shell.style.display = "block";
        if (loader) {
            loader.style.opacity = "0";
            setTimeout(() => loader.remove(), 300);
        }

    } catch (error) {
        console.error("Critical error during app initialization:", error);
        document.body.innerHTML = `<div style="padding: 2em; text-align: center; color: white;"><h1>Critical Error</h1><p>Could not start application. Check console for details.</p></div>`;
    }
}

// Init
document.addEventListener("DOMContentLoaded", main);

// Expose for HTML onclick handlers (legacy support)
window.app = app;
