import type { ExpoConfig } from "@expo/config";

const updatesEnabled = process.env.EXPO_PUBLIC_ENABLE_UPDATES === "true";

const config: ExpoConfig = {
  name: "Barra Scanner Mobile",
  slug: "barra-scanner-mobile",
  version: "1.0.0",
  jsEngine: "jsc",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.jdioses.barrascannermobile",
  },
  android: {
    package: "com.jdioses.barrascannermobile",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-sharing", "expo-font"],
  updates: {
    enabled: updatesEnabled,
    checkAutomatically: "ON_ERROR_RECOVERY",
    fallbackToCacheTimeout: 0,
  },
  extra: {
    firebaseConfigured: Boolean(
      process.env.EXPO_PUBLIC_FIREBASE_API_KEY &&
      process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN &&
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.EXPO_PUBLIC_FIREBASE_APP_ID
    ),
    updatesEnabled,
    eas: {
      projectId: "9df1d304-2e6c-4f53-8de2-0a68f66ac050",
    },
  },
};

if (updatesEnabled) {
  config.runtimeVersion = {
    policy: "appVersion",
  };
}

export default config;
