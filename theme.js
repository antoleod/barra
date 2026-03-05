const THEME_KEY = "barra_theme";

export const themeManager = {
  themes: {
    dark: { bg: "#0f1218", fg: "#eaf1fb", accent: "#3ea6ff", muted: "#8ea2b7", card: "#171d27", border: "#2a3444" },
    light: { bg: "#f6f8fc", fg: "#132033", accent: "#1d5fd3", muted: "#5b6c82", card: "#ffffff", border: "#d6deea" },
    eu_blue: { bg: "#001a57", fg: "#f3f7ff", accent: "#ffd617", muted: "#9eb4e8", card: "#02226f", border: "#224896" },
  },

  loadStored() {
    try {
      return JSON.parse(localStorage.getItem(THEME_KEY) || "null");
    } catch {
      return null;
    }
  },

  apply(themeName = "dark", customAccent = "") {
    const root = document.documentElement;
    const chosen = this.themes[themeName] || this.themes.dark;
    root.style.setProperty("--bg", chosen.bg);
    root.style.setProperty("--text", chosen.fg);
    root.style.setProperty("--accent", customAccent || chosen.accent);
    root.style.setProperty("--muted", chosen.muted);
    root.style.setProperty("--bg-soft", chosen.card);
    root.style.setProperty("--bg-elev", chosen.card);
    root.style.setProperty("--stroke", chosen.border);
    root.setAttribute("data-theme-name", themeName);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", chosen.bg);
  },

  persist(themeName, customAccent) {
    localStorage.setItem(THEME_KEY, JSON.stringify({ themeName, customAccent }));
  },
};
