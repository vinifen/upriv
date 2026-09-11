# upriv-mobile (Expo 52)

React Native shell for Upriv. Shares `@upriv/shared` (types, i18n, budgets, `AppServices`).

## Status

- **Mocks only** via `createMobileServices()` — no Rust/JNI yet (Expo Go OK).
- Visual language shares `@upriv/shared` theme palettes with desktop.
- Shipped so far: AppProviders → Gate → vault list + System settings / Logs / Help.
- Vault create / lifecycle / file-manager: stubs in services; UI screens still to port.

Paths in mocks use `content://upriv.mock/...` (SAF-shaped), not desktop filesystem paths.

## Run

```bash
cd dev
./run mobile                 # wipe Metro/Expo cache, expo start --clear
./run mobile --android       # same, then open Android
# or, without cache wipe:
cd apps/mobile
npm install
npm start          # Expo Go
npm run typecheck
```

## Layout

```
src/
  providers/AppProviders.tsx
  components/ui/     # Button, Modal, Toast, LoadingBudgetHint
  features/
    system/settings/ # Gate, Setup, AppSettings
    system/logs/
    system/help/
    vaults/list/
  platform/mocks/    # AppServices in-memory
  theme/tokens.ts    # desktop CSS variable parity
```
