# Barra Scanner - React Native + Expo + TypeScript

Este repositorio fue migrado a una app móvil con Expo y TypeScript.

## Proyecto activo

- `mobile/` contiene toda la app nueva.
- Los archivos web legacy fueron eliminados.

## Stack

- Expo SDK 55
- React Native
- TypeScript
- AsyncStorage (historial, settings, templates, logs)
- expo-camera (escaneo cámara + scan desde imagen)

## Funcionalidad migrada

- Escaneo por cámara
- Escaneo de imagen
- Historial local
- Export CSV
- Limpieza de historial
- Diagnósticos (copy/export)
- Auto Detect por reglas (PI, RITM, REQ, INC, SCTASK, QR)
- Extracción estructurada por regex + plantillas
- Theme selector (dark/light/eu_blue + accent)

## PI logic

La lógica PI se mantuvo idéntica en comportamiento para FULL/SHORT.

Archivo:
- `mobile/src/core/settings.ts` (`piLogic.normalize/convert/validate`)

## Ejecutar

```bash
cd mobile
npm install
npm run start
```

Luego abrir en Expo Go / emulador.

## Notas

- Modo por defecto: local-first.
- NFC no está habilitado por defecto en Expo managed (requiere librería nativa/configuración adicional).
- Si quieres, en el siguiente paso conecto Firebase en RN (Auth + Firestore) y agrego sync real en mobile.
