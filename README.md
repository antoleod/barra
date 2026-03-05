# Barra Scanner (Mobile-first PWA)

Barra Scanner is a resilient scanner PWA with optional Firebase sync and autonomous auto-detection.

## What was fixed (root causes)

- Firebase init 404 handling:
  - `/__/firebase/init.json` 404 is treated as expected on GitHub Pages.
  - App automatically falls back to Local Mode.
  - Sync actions are disabled gracefully in Local Mode.
  - Added `Recheck Firebase` action in Settings.

- Scanner concurrency:
  - Added `scannerController.js` orchestration.
  - Actions that require scanner idle (clear history, panel open, paste text, recheck Firebase, reset state) now stop scanner first, run action, then resume only when appropriate.

- Loader and boot reliability:
  - Boot state machine (`bootStatus`, `authStatus`, `persistenceMode`) updates UI chip state.
  - Loader is always removed; shell is always shown (even on boot errors).

- UI overlap/freeze prevention:
  - Mobile-safe fixed header/footer layout retained.
  - Panels close via X/backdrop/ESC.
  - Scrollable panel content remains interactive.

## Core modules

- `app.js` main orchestrator
- `scannerController.js` camera lifecycle + concurrency guard
- `classify.js` deterministic auto-classification (PI / SN / QR)
- `extract.js` structured field extraction from scanned/pasted payloads
- `templatesStore.js` template persistence (local + optional Firebase)
- `theme.js` theme manager (dark/light/eu_blue/custom accent)
- `ui/layout.js` boot UI helpers
- `firebase-service.js` optional Firebase runtime/auth/sync
- `diagnostics.js` rolling diagnostics log (last 200)

## Features

- Camera scan
- Image scan
- NFC scan
- Paste ticket text + extraction
- Auto Detect default mode
- PI conversion rules preserved exactly
- History with type badges
- Export CSV (includes type/profile/structured fields)
- Local history clear/reset UI state
- Copy logs + Export logs JSON
- Optional Firebase auth/sync

## Local mode

If Firebase config is unavailable, the app works fully in Local Mode:
- scanning + history + CSV export continue working
- sync is disabled
- status chip shows Local Mode

## Optional Firebase setup

The app tries config in this order:
1. fresh cache (`firebase_config_cache`, <24h)
2. `/__/firebase/init.json` (timeout 2000ms)
3. stale cache fallback
4. manual config from `firebase_manual_config` or `window.__FIREBASE_CONFIG__`

If all fail, Local Mode is used automatically.

## Auto Detect

Default profile is `AUTO`:
- ServiceNow: `INC\d+`, `RITM\d+`, `REQ\d+`, `SCTASK\d+`
- PI candidate detection via existing PI validator/converter logic
- QR fallback for non-empty payloads

Saved record includes resolved `type`, normalized value, and extracted structured fields.

## Templates and extraction

Templates are saved locally and optionally in Firebase:
- id, name, type
- regex rules
- mapping rules
- sample payloads

Most-recent templates are applied first for extraction.

## Deploy to GitHub Pages

1. Push branch to GitHub.
2. Enable Pages for repository/branch.
3. Ensure static files are published from repo root.
4. Validate camera permissions on mobile.

## CI/CD note

The web app cannot push commits by itself. For auto-deploy, use GitHub Actions to deploy Pages on push.
