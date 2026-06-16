# Upriv — mobile (scaffold)

**Expo SDK 52** + **React Native 0.76** + **React 18.3.1** — aligned with `dev/apps/desktop/` for shared TypeScript (`@upriv/shared`) and i18n keys.

No vault UI yet, no `upriv-core` native module. **Not** Tauri mobile (product uses React Native + Rust FFI).

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22 LTS (`../../.nvmrc` from repo root) |
| Android | Android Studio, SDK 35, **JDK 17**, NDK **r27** (when building native) |
| iOS | Xcode 16+ (macOS only) |

For day-one UI work you can use **Expo Go** (SDK 52). Custom Rust (`libupriv_core.so`) will require a **development build** later.

## Commands

```bash
cd dev/apps/mobile
npm install
npm start              # Metro + QR (Expo Go)
npm run android
npm run ios            # macOS + Xcode
npm run typecheck
```

From `dev/` root:

```bash
npm run mobile:start
```

## Layout

```text
mobile/
├── src/App.tsx           # UI placeholder (strings from @upriv/shared locales)
├── src/native/           # Future JNI / iOS bridge to upriv-core
├── assets/               # Expo icons (replace with Upriv brand later)
├── app.json              # Expo config (newArchEnabled: false)
└── metro.config.js       # Watches dev/apps + dev/docs for shared i18n HMR
```

Shared UI strings: `../shared/locales/` (same catalog as desktop via `@upriv/shared`).

**Scaffold limitations (post-MVP debt):** no lint/format scripts yet; `react-native-screens` / `safe-area-context` installed but unused.

Versions: `../../docs/VERSIONS.md`.

## React Native architecture

`app.json` sets **`newArchEnabled: false`** (Fabric/TurboModules off), aligned with `.agent/AGENT.md` and `docs/VERSIONS.md` for the current scaffold. Revisit when the mobile MVP starts and native modules (`upriv-core`) land.
