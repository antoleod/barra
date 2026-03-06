# Barra Scanner - React Native + Expo + TypeScript

Proyecto migrado a app móvil con Expo + TypeScript.

## Estructura

- `mobile/` app activa
- legacy web eliminado

## Funcionalidad

- Camera scan
- Image scan
- Auto detect (PI / RITM / REQ / INC / SCTASK / QR)
- Extracción estructurada por regex + templates
- Historial local
- Export CSV
- Logs copy/export JSON
- Theme selector

## PI logic

La lógica PI (FULL/SHORT) conserva comportamiento idéntico en:

- `mobile/src/core/settings.ts` (`piLogic.normalize/convert/validate`)

## Firebase (opcional) en React Native

Si defines estas variables de entorno, se habilita Auth + Firestore sync:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` (opcional)
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` (opcional)

Sin estas variables la app cae automáticamente a Local Mode.

## Ejecutar

```bash
cd mobile
npm install
npm run start
```

## Verificación

```bash
cd mobile
npx tsc --noEmit
```
