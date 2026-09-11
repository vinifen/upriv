# Upriv

**Upriv** — portable encrypted vault manager (`contents/` at rest; export a `.zip` of that ciphertext or a `.7z`). Product docs and reference demo bundle.

## Language

| Scope | Language |
|-------|----------|
| Docs, config, code, logs, bundles | **English** |
| App UI | **i18n keys** → `dev/apps/shared/locales/en.json`, `pt-BR.json`, `es.json` |

See **`dev/docs/LOCALE.md`** for the full policy.

## Repository layout

| Path | Purpose |
|------|---------|
| **`dev/apps/desktop/`** | **Desktop UI** — React web (v0.1); see `dev/apps/desktop/README.md` |
| **`dev/apps/electron/`** | **Desktop shell** — Electron + `upriv-daemon` sidecar |
| **`dev/crates/upriv-core/`** | **Shared Rust core** (`upriv_core` library) |
| **`dev/crates/upriv-rpc/`** | **Shared JSON-RPC handlers** — used by daemon and mobile FFI |
| **`dev/crates/upriv-daemon/`** | **Desktop RPC** — stdio NDJSON sidecar to `upriv-core` (no TCP port) |
| **`dev/crates/upriv-ffi/`** | **Mobile FFI** — UniFFI `libupriv_ffi` for Expo/Android |
| **`dev/apps/mobile/`** | **Mobile UI** — Expo 52 + React Native (mocks in Expo Go; native FFI in a dev client) |
| **`dev/apps/shared/`** | **@upriv/shared** — TS domain types + service interfaces (desktop + mobile) |
| **`dev/docs/`** | PRD, SDD, **`ARCHITECTURE.md`**, `LOCALE.md`, `VERSIONS.md` |
| **`docs/gitflow/`** | GitFlow: branches, commits, PRs, issues, labels |
| **`VERSION`** | Product SemVer (single source; sync into `dev/` manifests) |

**Stack:** desktop = React 18 + Vite 6 + Electron + Rust; mobile = Expo SDK 52 + RN 0.76. Pinned versions: **`dev/docs/VERSIONS.md`**.

**Start here:** `dev/README.md` · `dev/docs/prd.md` · `dev/docs/sdd.md` · `dev/docs/ARCHITECTURE.md`  
**Contribute / GitFlow:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`docs/gitflow/`](docs/gitflow/README.md)  
**Private reports:** [`SECURITY.md`](SECURITY.md)  
**AI agents:** `.agent/AGENT.md`
