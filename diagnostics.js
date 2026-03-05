const LOG_KEY = "barra_diag_logs";
const MAX_LOGS = 200;

function nowIso() {
  return new Date().toISOString();
}

function normalizeLog(level, event, data = null) {
  return {
    ts: nowIso(),
    level,
    event,
    data,
  };
}

function safeParseLogs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

class Diagnostics {
  constructor() {
    this.logs = safeParseLogs(localStorage.getItem(LOG_KEY));
  }

  write(level, event, data = null) {
    const item = normalizeLog(level, event, data);
    this.logs.push(item);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
    }
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(this.logs));
    } catch {
      // best effort only
    }
    const payload = data ? `${event} ${JSON.stringify(data)}` : event;
    if (level === "error") {
      console.error(`[diag] ${payload}`);
    } else if (level === "warn") {
      console.warn(`[diag] ${payload}`);
    } else {
      console.log(`[diag] ${payload}`);
    }
  }

  info(event, data = null) {
    this.write("info", event, data);
  }

  warn(event, data = null) {
    this.write("warn", event, data);
  }

  error(event, data = null) {
    this.write("error", event, data);
  }

  clear() {
    this.logs = [];
    try {
      localStorage.removeItem(LOG_KEY);
    } catch {
      // best effort only
    }
  }

  getLogs() {
    return [...this.logs];
  }

  getText() {
    return this.logs.map((line) => {
      const suffix = line.data ? ` ${JSON.stringify(line.data)}` : "";
      return `${line.ts} [${line.level.toUpperCase()}] ${line.event}${suffix}`;
    }).join("\n");
  }

  getJson() {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const diag = new Diagnostics();
