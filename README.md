# Barra Scanner (PWA)

Barra Scanner is a mobile-first PWA for scanning codes with camera, image upload, and NFC, with local history + optional Firebase sync.

## Features

- Camera scan (`html5-qrcode`)
- Image scan
- NFC scan
- Local history (IndexedDB)
- CSV export
- Clear local history
- Service worker offline shell
- Optional Firebase auth + Firestore sync
- Scan Profiles:
  - `pi_full`
  - `pi_short`
  - `sn_ritm`
  - `sn_req`
  - `sn_inc`
  - `sn_sctask`
  - `qr`
  - `api`
  - `test`

## Run locally

1. Install a static server (example):

```bash
npm i -g serve
```

2. Start the app from repo root:

```bash
serve .
```

3. Open the local URL in your browser.

Notes:
- On local servers, `/__/firebase/init.json` is usually unavailable.
- The app will run in local-only mode if Firebase config is missing.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Enable Pages on the branch/folder containing this app.
3. Ensure `index.html`, `app.js`, `firebase-service.js`, `sw.js`, `styles.css` are published.
4. Open your Pages URL and verify scanner permissions on mobile.

## Firebase on GitHub Pages

Because GitHub Pages does not provide Firebase Hosting endpoint `/__/firebase/init.json`, configure Firebase manually:

1. Create Firebase web app config in Firebase Console.
2. Save it in localStorage key `firebase_manual_config` (JSON with `apiKey`, `authDomain`, `projectId`, `appId`, etc.), or inject `window.__FIREBASE_CONFIG__` before importing `firebase-service.js`.
3. Optionally keep cache key `firebase_config_cache`.

Config load order in `firebase-service.js`:

1. Fresh cache (`firebase_config_cache`, < 24h)
2. Live fetch `/__/firebase/init.json` with `AbortController` timeout = 2000ms
3. Stale cache fallback
4. Manual config (`firebase_manual_config` / `window.__FIREBASE_CONFIG__`)
5. Local mode if none available

## Scan Profiles

Each scan profile defines:
- `id`
- `label`
- `shortLabel`
- `validate(raw)`
- `normalize(raw)`
- optional `apiAction(...)`

Behavior:
- PI profiles (`pi_full`, `pi_short`) use the original PI conversion logic unchanged.
- ServiceNow profiles enforce strict ticket formats (`RITM#######`, `REQ#######`, `INC#######`, `SCTASK#######`).
- QR accepts any non-empty value.
- API profile can POST normalized value to configured endpoint and still saves locally.
- Test profile supports synthetic scans for diagnostics.

History includes profile/type badges and can filter by type.
CSV export includes `Type` and `ProfileId` columns.

## Local mode and auth

- If Firebase is enabled and user is not authenticated, app redirects to `login.html`.
- If Firebase is not enabled, app remains usable in local mode and sync buttons are disabled.
- Loader is always dismissed after app boot; app should not stay on infinite loading.

## Diagnostics

A lightweight diagnostics logger stores recent app events in memory + localStorage (`barra_diag_logs`):
- boot events
- auth transitions
- loader events
- panel open/close
- scanner start/stop
- sync start/end/errors
- API scan results

Use Settings actions:
- `Copy logs`
- `Clear logs`
