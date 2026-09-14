# 🔐 Upriv

**Encrypted vaults you control** — files stay ciphertext on disk (`contents/`). Open in a session, lock when you’re done. Export a normal **`.zip` of that ciphertext** (recommended) or a portable **`.7z`**.

| | |
|---|---|
| **Version** | `0.2.0-beta` ([`VERSION`](VERSION)) |
| **Desktop** | Electron + React + Rust daemon |
| **Mobile** | Expo / React Native + UniFFI (`upriv-ffi`) |
| **UI languages** | English · Português (Brasil) · Español |

> **Today:** vault root setup, settings, vault list, create, groups, and open/close talk to live `upriv-core`. File manager / FUSE and change-password are still in progress.

---

## ✨ What it does

- 📁 **Data folder** — pick a default or custom root; repair / recover if something’s incomplete
- 🗂️ **Vault list** — create, group, sort, search, hide, open / lock
- 🔑 **Unlock** — Argon2id + AEAD at rest; optional public password hint
- 📦 **Export** — `.zip` of `contents/` (envelope only) or `.7z` (weaker offline guessing)
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

./run desktop              # Electron + Vite + upriv-daemon (wipes Vite cache)
./run mobile               # Expo / Metro (wipes cache)
./run mobile --android     # same, then open Android

./run help                 # all commands
```

Same via npm: `npm run desktop` · `npm run mobile` · `npm run mobile:android`.

| Want… | Command |
|--------|---------|
| Desktop app | `./run desktop` |
| Mobile (Expo) | `./run mobile` |
| Mobile on Android | `./run mobile --android` |
| Browser UI only (mocks, no Electron) | `npm run dev` (from `dev/`) |
| Lint + tests | `./run check` |

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
| **`.deb`** | Ubuntu / Debian install (preferred — no FUSE) |
| **`.AppImage`** | Portable; needs libfuse |

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
./run check     # rustfmt + clippy + tsc + eslint + prettier + cargo/vitest tests
./run lint-fix # auto-fix formatters where possible
./run test      # tests only
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
    ├── run                   # ./run desktop | mobile | check | …
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
  ./run check && ./run desktop
```
