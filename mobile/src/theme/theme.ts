export const themes = {
  dark: {
    bg: '#0f1218',
    fg: '#eaf1fb',
    accent: '#3ea6ff',
    muted: '#8ea2b7',
    card: '#171d27',
    border: '#2a3444',
  },
  light: {
    bg: '#f6f8fc',
    fg: '#132033',
    accent: '#1d5fd3',
    muted: '#5b6c82',
    card: '#ffffff',
    border: '#d6deea',
  },
  eu_blue: {
    bg: '#001a57',
    fg: '#f3f7ff',
    accent: '#ffd617',
    muted: '#9eb4e8',
    card: '#02226f',
    border: '#224896',
  },
};

export type ThemeName = keyof typeof themes;

