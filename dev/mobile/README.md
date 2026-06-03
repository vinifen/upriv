# Upriv — mobile (scaffold)

**Expo SDK 52** + **React Native 0.76** + **React 18.3.1** — aligned with `dev/desktop/` for shared TypeScript and i18n keys.

No vault features, no `upriv-core` native module yet. **Not** Tauri mobile (product uses React Native + Rust FFI).

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22 LTS (`../.nvmrc`) |
| Android | Android Studio, SDK 35, **JDK 17**, NDK **r27** (when building native) |
| iOS | Xcode 16+ (macOS only) |

For day-one UI work you can use **Expo Go** (SDK 52). Custom Rust (`libupriv_core.so`) will require a **development build** later.

## Commands

```bash
cd dev/mobile
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
├── src/App.tsx           # UI placeholder
├── src/native/           # Future JNI / iOS bridge to upriv-core
├── assets/               # Expo icons (replace with Upriv brand later)
├── app.json              # Expo config (newArchEnabled: false)
└── metro.config.js       # Watches parent `dev/` for shared i18n
```

Shared UI strings: `../docs/i18n/` (same as desktop).

Versions: `../docs/VERSIONS.md`.
