# 🔐 Upriv

**Encrypted vaults you control** — files stay ciphertext on disk (`store/`). Open in a session, lock when you’re done. Export a normal **`.zip` of that ciphertext** (recommended) or a portable **`.7z`**.

| | |
|---|---|
| **Version** | `0.2.2-beta` ([`VERSION`](VERSION)) |
| **Desktop** | Electron + React + Rust daemon |
| **Mobile** | Expo / React Native + UniFFI (`upriv-ffi`) |
| **UI languages** | English · Português (Brasil) · Español |

> **Today:** greenfield. One store format (`format_version` 1). Vault root setup, settings, vault list, create, groups, open/close, the in-app file manager, Linux FUSE, the Windows vault folder (WinFsp, installed when that folder is turned on), zip and `.7z` import/export, and backups talk to live `upriv-core`. Password change and unlock-RAM change are live on a closed vault.

---

## ✨ What it does

- 📁 **Data folder** — pick a default or custom root; repair / recover if something’s incomplete
- 🗂️ **Vault list** — create, group, sort, search, hide, open / lock
- 🔑 **Unlock** — Argon2id + AEAD at rest; optional public password hint
- 📦 **Export** — `.zip` of `store/` (envelope only) or `.7z` (weaker offline guessing)
- 🖥️📱 **Same product** — shared domain package `@upriv/shared` on desktop and mobile

**Security stance (short):** default mode never leaves a decrypted vault tree on ordinary disk. Details: [`.agent/SECURITY-CRYPTO.md`](.agent/SECURITY-CRYPTO.md) · [`.agent/SECURITY-PLAINTEXT.md`](.agent/SECURITY-PLAINTEXT.md).

---

## 🚀 Quick start

Everything runs from **`dev/`**.

### 1. Prerequisites

- **Node.js 22.12+** — `cd dev && nvm use` (see `dev/.nvmrc`)
- **Rust 1.94.0** — rustup picks it up from `dev/rust-toolchain.toml`
- **Desktop:** Linux (or Windows / macOS for packaging)
- **Mobile Android:** JDK + Android SDK / emulator or device

### 2. Install dependencies (once)

```bash
cd dev

npm install --prefix js-lint
npm install --prefix apps/shared
npm install --prefix apps/desktop
npm install --prefix apps/electron
npm install --prefix apps/mobile
```

There is **no** `npm install` at the `dev/` root.

### 3. Run

```bash
cd dev

./r d                # Electron + Vite + upriv-daemon (wipes Vite cache)
./r m                # Expo / Metro (wipes cache)
./r m -a             # same, then open Android

./r h                # all commands
```

Same via npm: `npm run desktop` · `npm run mobile`. `npm run mobile -- -a` opens Android. `npm run mobile:android` is a native rebuild, not that command.

| Want… | Command |
|--------|---------|
| Desktop app | `./r d` |
| Mobile (Expo) | `./r m` |
| Mobile on Android | `./r m -a` |
| Vite renderer alone (no Electron, so every call fails with `shell_unavailable`) | `npm run dev` (from `dev/`) |
| Lint + tests | `./r c` |

---

## 🏗️ Build

### Desktop (Linux)

```bash
cd dev
npm run electron:build
# → .deb + .AppImage in target/release/bundle/electron/
```

| Artifact | Use |
|----------|-----|
| **`.deb`** | Ubuntu / Debian install (preferred; does not install `fuse3`) |
| **`.AppImage`** | Portable; starts without system `libfuse2` |

### Desktop (Windows)

Build **on Windows** (not cross-compiled from Linux by default):

```bash
cd dev
npm run electron:build:win
```

Guide: [`dev/docs/WINDOWS-BUILD.md`](dev/docs/WINDOWS-BUILD.md).

### Mobile (Android release APK)

```bash
cd dev/apps/mobile/android
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Needs a linked native FFI build for real vault I/O (dev-client / release), not Expo Go alone.

---

## ✅ Quality gate

```bash
cd dev
./r c     # rustfmt + clippy + tsc + eslint + prettier + cargo/vitest tests
./r f     # auto-fix formatters where possible
./r t     # tests only
```

---

## 📂 Repository map

```text
upriv/
├── README.md                 ← you are here
├── VERSION                   # product SemVer
├── CONTRIBUTING.md
├── SECURITY.md
├── .agent/                   # AI + security contracts
├── docs/gitflow/             # branches, commits, PRs
└── dev/                      # ← all implementation
    ├── README.md             # deep workspace / packaging notes
    ├── r, r.cmd, r.ps1       # ./r d | m | c | … (bash, cmd, PowerShell)
    ├── apps/
    │   ├── desktop/          # React UI
    │   ├── electron/         # Electron shell
    │   ├── mobile/           # Expo / RN
    │   └── shared/           # @upriv/shared
    ├── crates/
    │   ├── upriv-core/       # crypto + vault I/O
    │   ├── upriv-rpc/        # shared RPC handlers
    │   ├── upriv-daemon/     # desktop sidecar
    │   └── upriv-ffi/        # mobile UniFFI
    └── docs/                 # PRD · SDD · ARCHITECTURE · VERSIONS
```

---

## Third-party notice

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos. The Windows setup and the portable app ship the official unmodified WinFsp installer and ask to install it when the file manager folder is turned on. Declining leaves that switch unchanged. Repository: https://github.com/winfsp/winfsp

## 📚 Docs

| Doc | What |
|-----|------|
| [`dev/README.md`](dev/README.md) | Workspace layout, packaging matrix, Linux troubleshooting |
| [`dev/docs/ARCHITECTURE.md`](dev/docs/ARCHITECTURE.md) | How the pieces fit |
| [`dev/docs/prd.md`](dev/docs/prd.md) · [`sdd.md`](dev/docs/sdd.md) | Requirements & design |
| [`dev/docs/VERSIONS.md`](dev/docs/VERSIONS.md) | Pinned Node / Rust / Expo / Electron |
| [`dev/docs/LOCALE.md`](dev/docs/LOCALE.md) | i18n policy |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`docs/gitflow/`](docs/gitflow/README.md) | How we ship changes |
| [`SECURITY.md`](SECURITY.md) | Private vulnerability reports |
| [`.agent/AGENT.md`](.agent/AGENT.md) | Context for AI agents |

---

## 🌐 Language policy

| Scope | Language |
|-------|----------|
| Docs, config, code, logs | **English** |
| App UI | i18n → `dev/apps/shared/locales/{en,pt-BR,es}.json` |

---

## 💬 One-liner for contributors

```bash
cd dev && nvm use && \
  npm install --prefix js-lint && \
  npm install --prefix apps/shared && \
  npm install --prefix apps/desktop && \
  npm install --prefix apps/electron && \
  npm install --prefix apps/mobile && \
  ./r c && ./r d
```
