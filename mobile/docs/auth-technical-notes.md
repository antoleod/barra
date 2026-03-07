# Auth Technical Notes

## Found existing auth base
- `src/core/firebase.ts` already contained Firebase runtime init, email/password auth helpers, auth state listener, and Firestore sync.
- A first draft of auth UI/context existed in local working tree (`src/core/AuthContext.tsx` and `src/core/AuthScreen.tsx`), but it was not wired cleanly to the app entry flow.

## Missing pieces
- `App.tsx` was importing auth files from `src/auth/*` while the files were actually under `src/core/*`, causing typecheck failures.
- `App.tsx` had no default export and no auth gate rendering between auth and app states.
- Auth session persistence for React Native was not explicitly configured (risk of session loss on reload).
- No explicit Firebase guard message for missing required env vars in the auth UI.
- Auth UI/forms were monolithic and not split into reusable Login/Register/Forgot components.

## Reused from barra
- Existing Firebase helper functions (`loginWithEmail`, `registerWithEmail`, reset password, logout, auth listener, syncScansWithFirebase).
- Existing diagnostics logger (`diag`) and current sync flow in main scanner screen.
- Existing main scanner/history/settings experience preserved and moved into `src/screens/MainAppScreen.tsx`.

## Adapted from clipboard
- Service + provider pattern for auth separation (service layer + auth context + flow screen).
- Friendly auth error mapping strategy from Firebase error codes.
- Split auth flow structure (login/register/forgot views) adapted to React Native components.

## Newly implemented
- New modular auth package under `src/auth/`:
  - `AuthScreen.tsx`
  - `LoginForm.tsx`
  - `RegisterForm.tsx`
  - `ForgotPasswordForm.tsx`
  - `authService.ts`
  - `authContext.tsx`
  - `useAuth.ts`
  - `authTypes.ts`
- Clean app bootstrap in `App.tsx` with provider + auth gate.
- `src/screens/MainAppScreen.tsx` as isolated main app module.
- Firebase runtime guard details (missing required/optional env) plus React Native auth persistence setup.
- `.env.example` updated with `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`.
