# Architecture — Upriv (cross-platform stack)

**Language:** English (UI copy: `dev/apps/shared/locales/` — see `LOCALE.md`)

**Version:** 0.2  
**Date:** 2026-05-31  
**Status:** Approved direction (replaces Flutter mobile stack in SDD §9.1)  
**Companion:** `prd.md`, `sdd.md`

---

## 1. Summary

| Platform | UI | Shell | Core | Deliverable |
|----------|-----|-------|------|-------------|
| **Desktop** (Linux, Windows, macOS; x86_64 + ARM64) | React (web) + TypeScript | Electron + `upriv-daemon` | `upriv-core` (Rust) | Single executable per OS (`.exe`, AppImage, `.app`, …) |
| **Mobile** (Android v2, iOS v3) | React Native + TypeScript | RN native runtime | `upriv-core` (Rust) | Single APK / IPA (Rust as `.so` / static lib inside the package) |

**One Rust core, two UI stacks.** Desktop and mobile share `upriv-core`, i18n keys, types, and business flows — not the same JSX/DOM markup.

---

## 2. Layer responsibilities

### 2.1 UI (React / React Native) — presentation only

The UI layer **must not** implement:

- Encryption or decryption
- Password derivation or key handling (beyond collecting input and passing it to Rust)
- Disk I/O on vault paths (read/write/delete)
- FUSE / mount / SAF file operations
- `7zz` invocation
- Session state persistence on disk

The UI **does**:

- Render screens (vault list, unlock, settings, backups, recovery)
- Collect user input (password, vault name, order)
- Call Rust (`invoke` on desktop, native module on mobile)
- Display errors, progress, and i18n strings
- Hold the password in JS memory **only while the unlock dialog is open**; pass to Rust immediately; never store in `localStorage`, files, or app config

### 2.2 `upriv-core` (Rust) — all sensitive and I/O logic

Single crate, compiled per target triple:

| Concern | Owner |
|---------|--------|
| RAM session, `zeroize` passwords | `upriv-core` |
| Crypto (Argon2id, AEAD) | `upriv-core` |
| Disk / SAF via `VaultStorage` trait | `upriv-core` |
| `7zz` spawn, stream, temp files | `upriv-core` |
| Vault state machine (`open` / `closed` / `sealed`) | `upriv-core` |
| Recovery, manifest, lockfile | `upriv-core` |
| FUSE mount (Linux desktop) | `upriv-core` + platform module |

Platform-specific code lives behind **`#[cfg(...)]`** or the **`VaultStorage`** trait — not in separate “business logic” crates.

### 2.3 Bridge (UI ↔ Rust)

A **bridge** is generated or hand-written glue that lets the UI language call Rust:

| Platform | Bridge mechanism |
|----------|------------------|
| Desktop (Electron) | stdio JSON-RPC via `upriv-daemon` + `window.upriv.invoke()` preload |
| Mobile (React Native) | Native module (JNI on Android, static lib + Obj-C/Swift shim on iOS); e.g. `uniffi` or `react-native-rust` pattern |

The bridge is **code inside the same package** (same `.exe` or same APK) — not a separate app or service.

---

## 3. Packaging model

### 3.1 Desktop

One **native executable** per OS/architecture. Bundled inside or beside it:

- Chromium shell (Electron)
- Compiled frontend assets (`renderer-out/` → bundled as `renderer/`)
- `upriv-daemon` sidecar + `upriv-core`
- `7zz` for the target triple

**Validated builds (2026-07-03):**

- Linux: `dev/target/release/bundle/electron/Upriv-0.1.0.AppImage`

Build commands: see `dev/README.md` and `dev/apps/desktop/README.md`.

### 3.2 Mobile (Android)

**One APK** contains everything:

- React Native (JS bundle + native views)
- Bridge (native module)
- `libupriv_core.so` (ARM64)
- `7zz` (`arm64-v8a`, `jniLibs` or assets)

There is **no standalone `.exe` on Android** — the user installs one app icon; Rust is a native library inside the APK.

Distribution: `.upriv/app/Android/Upriv.apk` on the vault HD bundle (PRD §3.6) or other install source.

---

## 4. Repository layout

Development workspace (`dev/`):

```text
dev/
├── apps/
│   ├── desktop/              # React web UI (Vite)
│   ├── electron/             # Electron main/preload + electron-builder
│   ├── mobile/               # Expo / React Native scaffold
│   └── shared/               # @upriv/shared — TS domain types + service interfaces
├── crates/
│   ├── upriv-core/           # Shared Rust core
│   └── upriv-daemon/         # Desktop RPC sidecar → upriv-core
├── docs/
│   ├── prd.md
│   ├── sdd.md
│   ├── ARCHITECTURE.md
│   └── i18n/
├── Cargo.toml                # Rust workspace (upriv-core + upriv-daemon)
└── package.json              # dev scripts only (no root node_modules)
```

**Note:** Run `npm run electron:dev` from `dev/` (see `dev/apps/desktop/README.md`).

---

## 5. Code sharing (React web ↔ React Native)

| Shared (`shared/`) | Platform-specific |
|-----------------------------|-------------------|
| TypeScript types (`VaultRow`, settings DTOs) | Markup: `<div>` vs `<View>` |
| i18n keys and loaders | Styling: Tailwind vs StyleSheet / NativeWind |
| State hooks and flow logic | Modals, navigation, gestures |
| API function signatures (call into Rust) | `desktopInvoke` vs RN native module |

**Same component tree concept** (App → VaultList → VaultRow → modals), **different implementations** per platform (`.tsx` web vs `.native.tsx` or shared props + platform files).

Do **not** expect to copy `dev/apps/desktop/src/App.tsx` verbatim into React Native.

---

## 6. `VaultStorage` abstraction

Required from day one in `upriv-core` so desktop and mobile share logic:

```rust
trait VaultStorage {
    fn read_file(&self, relative: &str) -> Result<Vec<u8>>;
    fn write_file(&self, relative: &str, data: &[u8]) -> Result<()>;
    fn list_dir(&self, relative: &str) -> Result<Vec<String>>;
    fn delete_tree(&self, relative: &str) -> Result<()>;
}
// Desktop: std::fs::Path
// Android: SAF (DocumentFile + ContentResolver) — URIs, not /storage/… paths
```

See SDD §9.4 for Android SAF flow.

---

## 7. Recorded decisions (ADR)

| ID | Decision | Choice | Reason |
|----|----------|--------|--------|
| ADR-01 | Desktop UI | React web + Electron | Stable Chromium on Linux/Win/Mac; AppImage validated (2026-07-03) |
| ADR-02 | Mobile UI | React Native + TypeScript | Close to React mental model; max reuse of TS structure with desktop; one APK with Rust inside |
| ADR-03 | Mobile UI (rejected) | ~~Flutter~~ | Superseded by ADR-02; team prefers React ecosystem for shared structure |
| ADR-04 | Mobile shell (rejected) | ~~Tauri Android~~ | Experimental; not acceptable for production vault app |
| ADR-05 | Desktop UI (rejected) | ~~React Native desktop for Linux~~ | No official stable RN for Linux; Electron is the desktop path |
| ADR-06 | Core | Single `upriv-core` crate | One implementation of crypto, 7z, states; compile to `.so`/`.dll`/linked exe per target |
| ADR-07 | Security boundary | UI = presentation; Rust = secrets + I/O | Minimize attack surface in JS; passwords never persisted in UI layer |
| ADR-08 | Android packaging | Single APK | RN + bridge + `libupriv_core.so` + `7zz` in one installable package |
| ADR-09 | Desktop packaging | Single executable per OS/arch | Electron + `upriv-daemon`; `7zz` embedded |
| ADR-10 | RN on Windows/macOS desktop | Not planned | Desktop stays React web + Electron; avoids duplicate desktop stacks |

---

## 8. Platform matrix

| OS | Phase | UI | Mount / workspace | Status |
|----|-------|-----|-------------------|--------|
| Linux x86_64 / ARM64 | v1 | Electron + React | FUSE → encrypted store | In development |
| Windows x86_64 / ARM64 | v1 | Electron + React | WinFsp or equivalent | Planned |
| macOS | v1.1 | Electron + React | Platform mount | Planned |
| Android | v2 | React Native | SAF; `workspace/` on OTG HD | Planned |
| iOS | v3 | React Native | Document picker + SAF-like APIs | Planned |

---

## 9. Implementation order

1. Implement **`dev/crates/upriv-core/`** (crypto, 7z, state machine).
2. Implement **`VaultStorage`** (desktop `std::fs` first).
3. Wire RPC handlers in `dev/crates/upriv-daemon/` to `upriv-core` only (thin `rpc.rs`).
4. **`dev/apps/shared/`** (`@upriv/shared`) — domain types, service interfaces, and UI locale catalogs (`locales/`).
5. Complete desktop v1 (Linux FUSE + Windows WinFsp, open/close/seal).
6. **`dev/apps/mobile/`** — native module → `upriv-core` (JNI / UniFFI).
7. Android: SAF adapter, APK packaging, OTG flows (PRD §3.6).

---

## 10. References

- [Electron](https://www.electronjs.org/)
- [React Native](https://reactnative.dev/)
- [uniffi](https://mozilla.github.io/uniffi-rs/) (candidate for RN ↔ Rust)
- PRD §3.5–3.6, SDD §4, §8, §9

---

*When this document conflicts with older SDD mentions of Flutter, **this document wins** for stack choice (2026-05-31). Product requirements in PRD §3.6 (SAF, APK, workspace on HD) are unchanged.*
