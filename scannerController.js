import { diag } from "./diagnostics.js";

export class ScannerController {
  constructor({ readerId, onDecoded, onStatus }) {
    this.readerId = readerId;
    this.onDecoded = onDecoded;
    this.onStatus = onStatus;
    this.instance = null;
    this.state = "idle";
    this.queue = Promise.resolve();
    this.restartTimer = null;
    this._scanCallback = (decodedText) => this.onDecoded(decodedText);
  }

  runExclusive(label, task) {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        diag.info("scanner.action", { label, state: this.state });
        return task();
      });
    return this.queue;
  }

  canStart() {
    return this.state !== "starting" && this.state !== "scanning";
  }

  async _ensureInstance() {
    if (!this.instance) {
      this.instance = new Html5Qrcode(this.readerId, { verbose: false });
    }
  }

  async start() {
    return this.runExclusive("start", async () => {
      if (!this.canStart()) return true;
      if (!("Html5Qrcode" in window)) {
        this.state = "error";
        this.onStatus?.("Scanner library unavailable");
        return false;
      }

      await this._ensureInstance();
      const cfg = { fps: 10, aspectRatio: 1.7777778 };
      this.state = "starting";
      this.onStatus?.("Starting camera");

      const attempts = [
        { cam: { facingMode: { exact: "environment" } }, tag: "exact" },
        { cam: { facingMode: "environment" }, tag: "environment" },
      ];

      for (const attempt of attempts) {
        try {
          await this.instance.start(attempt.cam, cfg, this._scanCallback, () => {});
          this.state = "scanning";
          this.onStatus?.("Ready to scan");
          diag.info("scanner.started", { mode: attempt.tag });
          return true;
        } catch {
          // continue fallback
        }
      }

      try {
        const cams = await Html5Qrcode.getCameras();
        if (!cams?.length) throw new Error("No camera found");
        const back = cams.find((c) => {
          const label = String(c.label || "").toLowerCase();
          return label.includes("back") || label.includes("rear") || label.includes("trase") || label.includes("environment");
        });
        await this.instance.start((back || cams[0]).id, cfg, this._scanCallback, () => {});
        this.state = "scanning";
        this.onStatus?.("Ready to scan");
        diag.info("scanner.started", { mode: "camera_list" });
        return true;
      } catch (error) {
        this.state = "error";
        this.onStatus?.("Could not open camera");
        diag.error("scanner.start_failed", { message: error?.message || String(error) });
        return false;
      }
    });
  }

  async stop() {
    return this.runExclusive("stop", async () => {
      if (!this.instance || this.state !== "scanning") {
        this.state = this.state === "starting" ? "starting" : "stopped";
        return true;
      }
      try {
        await this.instance.stop();
      } catch {
        // ignore stop errors
      }
      this.state = "stopped";
      diag.info("scanner.stopped");
      return true;
    });
  }

  async pause(ms = 1000, shouldResume = true) {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.stop();
    if (shouldResume) {
      this.restartTimer = setTimeout(() => {
        this.start();
      }, ms);
    }
  }

  async runWithScannerIdle(label, task, shouldResume = true) {
    return this.runExclusive(`idle:${label}`, async () => {
      const wasScanning = this.state === "scanning";
      if (wasScanning) {
        await this.stop();
      }
      try {
        return await task();
      } finally {
        if (shouldResume && wasScanning) {
          await this.start();
        }
      }
    });
  }
}
