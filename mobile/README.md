# Barra Mobile

Expo + React Native + TypeScript scanner app with optional Firebase Auth + Firestore sync.

## Firebase setup

1. Copy env template:

```bash
cp .env.example .env
```

2. Fill Firebase values in `.env`:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional)

If required variables are missing, auth is disabled and the app shows a clear Firebase guard message.

## Run locally

```bash
npm install
npm run start
```

Other scripts:

```bash
npm run android
npm run ios
npm run web
npm run typecheck
npm test
```

## Auth flow validation

1. Open app with valid Firebase env values.
2. In `AuthScreen`, test `Crear cuenta` with email + password + confirm password.
3. Log out from Settings > Account.
4. Log in again with the same credentials.
5. Use `Olvide mi contrasena` and verify reset email dispatch.
6. Restart app and confirm session remains active.
7. Log out and confirm app returns to login screen.
8. Use `Continuar como invitado` to run local-only mode.

## File structure (auth)

- `src/auth/AuthScreen.tsx`
- `src/auth/LoginForm.tsx`
- `src/auth/RegisterForm.tsx`
- `src/auth/ForgotPasswordForm.tsx`
- `src/auth/authService.ts`
- `src/auth/authContext.tsx`
- `src/auth/useAuth.ts`
- `src/auth/authTypes.ts`
- `src/core/firebase.ts`
- `src/screens/MainAppScreen.tsx`
