import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'barra_diag_logs';
const MAX = 200;

export interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  data?: unknown;
}

class Diagnostics {
  private logs: LogEntry[] = [];
  private loaded = false;

  async init() {
    if (this.loaded) return;
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.logs = parsed.slice(-MAX);
      } catch {
        this.logs = [];
      }
    }
    this.loaded = true;
  }

  private async persist() {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(this.logs));
    } catch {
      // noop
    }
  }

  async write(level: LogEntry['level'], event: string, data?: unknown) {
    await this.init();
    this.logs.push({ ts: new Date().toISOString(), level, event, data });
    if (this.logs.length > MAX) this.logs = this.logs.slice(this.logs.length - MAX);
    await this.persist();
  }

  info(event: string, data?: unknown) { return this.write('info', event, data); }
  warn(event: string, data?: unknown) { return this.write('warn', event, data); }
  error(event: string, data?: unknown) { return this.write('error', event, data); }

  async clear() {
    this.logs = [];
    await AsyncStorage.removeItem(KEY);
  }

  async getLogs() {
    await this.init();
    return [...this.logs];
  }

  async getText() {
    const logs = await this.getLogs();
    return logs.map((x) => `${x.ts} [${x.level.toUpperCase()}] ${x.event}${x.data ? ` ${JSON.stringify(x.data)}` : ''}`).join('\n');
  }

  async getJson() {
    return JSON.stringify(await this.getLogs(), null, 2);
  }
}

export const diag = new Diagnostics();

