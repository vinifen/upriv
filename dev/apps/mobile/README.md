# upriv-mobile (Expo 52)

React Native shell for Upriv. Shares `@upriv/shared` (types, i18n, budgets, `AppServices`).

## Status

- `createServices()` uses in-process Rust (`upriv-ffi`, see [`src/native/README.md`](src/native/README.md)) when the Expo module is linked (dev-client / release APK), and `createMobileMockServices()` in Expo Go.
- Screens: Gate (setup / repair / storage-access reconnect), vault list and groups, create and import, open / close, in-app file manager, vault settings, backups, Info, Logs, Help, System settings, and the Data folder window with Export a copy.
- The data folder is a storage-access grant on Documents/Upriv. No FUSE: the in-app file manager is the folder.
- Visual language shares `@upriv/shared` theme palettes with desktop.

Paths in mocks use `content://upriv.mock/...` (SAF-shaped), not desktop filesystem paths.

## Run

```bash
cd dev
./r m                        # wipe Metro/Expo cache, expo start --clear
./r m -a                     # same, then open Android
# or, without cache wipe:
cd apps/mobile
npm install
npm start          # Expo Go
npm run typecheck
```

## Layout

```
modules/upriv-core/  # Expo module: UniFFI Kotlin, storage-access bridge (SafFs)
src/
  providers/AppProviders.tsx
  components/        # ui/ (Button, Modal, Toast, LoadingBudgetHint), settings/, system/
  features/
    system/          # settings (Gate, Setup, AppSettings, Data folder), data-folder-export, info, logs, help
    vaults/          # list, create, lifecycle, file-manager, settings, backups, info
  lib/rpc.ts         # typed CORE + mobile-only RPC helpers
  platform/
    services/        # createServices: native when linked, else mocks
    native/          # AppServices over upriv-ffi
    mocks/           # AppServices in memory (Expo Go)
  theme/tokens.ts    # desktop CSS variable parity
```
