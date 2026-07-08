# Upriv — AI agent context

**Product:** portable encrypted vault manager (universal `.7z` containers).  
**Repo:** monorepo with `dev/` (implementation), `prod-example/` (static vault layout demo).  
**Status:** v0.1 — `upriv-core` is minimal; **desktop** has a full mock vault UI (`dev/apps/desktop/`); **mobile** is scaffold-only.

When product behavior, security, or on-disk layout is unclear, **read the canonical docs** (below) before inventing behavior.

---

## Canonical documentation (read order)

| Priority | File | Role |
|----------|------|------|
| 1 | [`dev/docs/prd.md`](../dev/docs/prd.md) | **What** to build — requirements, UX, vault states, Android rules, non-goals |
| 2 | [`dev/docs/sdd.md`](../dev/docs/sdd.md) | **How** to build — state machine, TOML layout, `upriv-core` modules, 7z, FUSE, tests, implementation order |
| 3 | [`dev/docs/ARCHITECTURE.md`](../dev/docs/ARCHITECTURE.md) | **Stack** — React/Electron/RN, `upriv-core`, bridges, ADRs, platform matrix |
| 4 | [`dev/docs/VERSIONS.md`](../dev/docs/VERSIONS.md) | Pinned toolchains (Node, Rust, Electron, Expo) |
| 5 | [`dev/docs/LOCALE.md`](../dev/docs/LOCALE.md) | English for code/docs; UI via i18n keys only |
| 6 | [`prod-example/README.md`](../prod-example/README.md) | On-disk vault bundle contract (reference, not built from `dev/`) |

**Conflict resolution:** PRD + SDD define product behavior. `ARCHITECTURE.md` wins over older SDD mentions of Flutter. Stitch prototype (`dev/docs/stitch_upriv_vault_manager/`) is **design baseline only** — not authoritative for behavior or copy.

---

## PRD ↔ SDD map (where to look)

| Topic | PRD | SDD |
|-------|-----|-----|
| Vision, modes (`encrypted_dir` / `plain`), states | §1, §1.6–1.7 | §1, §2 |
| v1 Linux + Windows scope | §1.1, §3.5 | §1.1 principle 0, §14 |
| Functional requirements (RF-*) | §3 | §2–§7, §8–§9 |
| Desktop UX (vault list, modals) | §3.7 | §8.2 |
| Android (SAF, APK, workspace on HD) | §3.6 | §9 |
| Vault folder layout, `config.toml` | §5 | §3 |
| Password / session security | §4 | §6 |
| Non-functional (Rust core, UI boundary) | §6 (RNF-05) | §1.1, §4, §15 |
| Roadmap phases | §9 | §14 |
| `upriv-core` modules, public API sketch | §11 (glossary) | §4 |
| 7-Zip integration | (flow in §1.9) | §5 |
| Recovery | (states §1.7) | §7 |
| Implementation order for agents | §9 | **§14** (step-by-step) |
| ADR summary | — | §15 (+ `ARCHITECTURE.md` §7) |

---

## Product summary (do not contradict PRD/SDD)

- **Container:** AES-256 `.7z` per vault; **Plan B** = open archive in any 7-Zip-compatible tool.
- **Default mode (v1):** `encrypted_dir` — encrypted `store/` on disk; user edits via virtual `workspace/{display_name}/` (FUSE on Linux, WinFsp on Windows); **no durable plaintext** on HD in production.
- **Exception mode (v1):** `plain` — plaintext `workspace/` on HD between open/close; UI warnings + `secure_wipe_workspace` on close.
- **States:** `open` (runtime), `closed` (`encrypted_dir` cache), `sealed` (only `.7z` + config/backups). Misaligned store → **`recovery`**, not silent `closed`.
- **Close pipeline:** `7z t` on existing archive → stream new `.7z` from logical session content → test → atomic rename; never pack raw `.enc` blobs into the archive.
- **Passwords:** RAM only in v1; never in `localStorage`, UI config, or logs.

---

## Repository layout

```text
upriv/
├── .agent/                 # This file — AI project context
├── prod-example/           # Static demo vault-root (no build link to dev/)
├── README.md
└── dev/
    ├── Cargo.toml          # Rust workspace: upriv-core + upriv-daemon
    ├── Cargo.lock
    ├── rust-toolchain.toml # Rust 1.94.0 (pinned)
    ├── .nvmrc              # Node 22.12.0
    ├── apps/
    │   ├── desktop/        # React 18 + Vite 6 + Tailwind 3 (presentation)
    │   ├── electron/       # Electron shell (main/preload)
    │   ├── mobile/         # Expo 52 + RN 0.76 scaffold (presentation; no Rust bridge yet)
    │   └── shared/         # @upriv/shared — TS domain + service interfaces
    ├── crates/
    │   ├── upriv-core/     # ALL product Rust logic (API: upriv_core::)
    │   └── upriv-daemon/   # Desktop RPC sidecar ONLY — thin stdio JSON-RPC → upriv-core
    └── docs/
        ├── prd.md
        ├── sdd.md
        ├── ARCHITECTURE.md
        ├── VERSIONS.md
        ├── LOCALE.md
        └── i18n/           # en.json, pt-BR.json — UI strings only
```

---

## Architecture rules (mandatory)

### Layer boundaries

| Layer | Path | May do | Must NOT do |
|-------|------|--------|-------------|
| **UI desktop** | `dev/apps/desktop/` | Render, i18n, `desktopInvoke()` | Crypto, disk I/O, 7zz, vault state on disk |
| **UI mobile** | `dev/apps/mobile/` | Same (future native module) | Same |
| **Electron shell** | `dev/apps/electron/` | Window, spawn daemon, IPC preload | Business logic |
| **Desktop RPC** | `dev/crates/upriv-daemon/` | stdio JSON-RPC delegating to core | Business logic (keep `rpc.rs` thin) |
| **Core** | `dev/crates/upriv-core/` | Crypto, 7z, paths, state machine, FUSE, recovery | Depend on Electron |

**Desktop UI prototype (`dev/apps/desktop/`, mock layer):** vault list, lifecycle, file manager, settings, logs, and help run on in-memory mocks until `upriv-daemon`/`upriv-core` wiring. Notable conventions:

- **Pipeline:** `useVaultPipelineRun` enforces SDD §8.2.2 — one open/close/seal at a time (`isRunning`).
- **Auto-close:** at most one close per idle tick; warn toast once per vault per idle cycle; respects `isPipelineRunning`.
- **Settings ↔ list:** `registerMockVaultSettings` on save; list patch includes `storageMode` / `canSeal`.
- **Hidden until wired:** `close_on_app_exit` UI not exposed yet (`before-quit` runs daemon shutdown; vault `close_all` RPC still TODO).
- **Feature module boundaries:** each `features/vaults/*` and `features/system/*` folder has one `index.ts` — see [`dev/apps/desktop/README.md`](../dev/apps/desktop/README.md).

Replace mocks with `desktopInvoke()` → `upriv-daemon` → `upriv-core` before shipping crypto; do not treat JS `Map` passwords as production architecture.

### Data flow

```text
Desktop:  React ──desktopInvoke──► upriv-daemon ──► upriv_core::*
Mobile:   RN     ──JNI/FFI──► libupriv_core.so ──► upriv_core::*   (v2+)
```

### Rust workspace

- Build from `dev/`: `cargo build -p upriv-daemon`, `cargo test -p upriv-core`, `npm run rust:lint` (rustfmt + clippy).
- Artifacts go to **`dev/target/`** only — **never commit** `target/`, `node_modules/`, `dist/`, `.expo/`.
- `upriv-daemon/src/main.rs` is entry only; do not add vault logic there — use `upriv-core`.

### Planned `upriv-core` modules (SDD §4.2)

```text
upriv-core/src/
├── lib.rs
├── config/       # settings.toml, vaults/*/config.toml
├── vault/        # VaultManager: open, close, status
├── seven_zip/    # 7zz wrapper
├── session/      # RAM session, security modes
├── recovery/
├── paths/        # VaultRoot
├── mount/        # Virtual workspace trait; FUSE (Linux), WinFsp (Windows)
├── archive/      # PRD layers
├── store/
├── plain/        # Plaintext workspace open/close + secure_wipe (v1)
└── sync/         # sync_generation, hashes
```

---

## Toolchain (summary — details in VERSIONS.md)

| Tool | Version |
|------|---------|
| Node | 22.12+ (`.nvmrc`) |
| Rust | **1.94.0** (`rust-toolchain.toml`) |
| React (desktop + mobile) | 18.3.1 |
| Vite | 6.3.5 |
| Electron | 34.5.8; `electron-builder` 25.1.8 |
| Expo / RN | 52.0.49 / 0.76.9 |
| Mobile New Arch | `newArchEnabled: false` until native Rust bridge is tested |

Do not use floating `^` on Electron or React without re-validating builds.

---

## On-disk vault layout (contract)

Marker: **`.upriv/settings.toml`** at vault-root. Per-vault: **`vaults/<vault_id>/`** (`vault_id` = normalized slug).

| Path | Purpose |
|------|---------|
| `.upriv/settings.toml` | App/drive settings |
| `.upriv/state.json` | Open sessions only (volatile) |
| `.upriv/vaults/<id>/config.toml` | Vault config (survives seal) |
| `.upriv/vaults/<id>/persistence.json` | Persisted closed/sealed + sync metadata |
| `.upriv/vaults/<id>/archive/{display_name}.7z` | Main archive — **display name not normalized** |
| `.upriv/vaults/<id>/store/` | Encrypted store (`encrypted_dir`) |
| `.upriv/vaults/<id>/backups/` | Snapshot `.7z` files (normalized names) |
| `workspace/{display_name}/` | User-visible mount while open |

Reference tree: **`prod-example/`** (standalone; set `UPRIV_VAULT_ROOT` to test desktop against it).

**Naming:** `vault_id` normalized; `display_name` and main `.7z` keep user spelling (see `prod-example/README.md` forbidden-character rules).

---

## v1 implementation order (SDD §14)

Work in this order unless the user explicitly reprioritizes:

1. `upriv-core`: config load, paths, `SevenZip` wrapper + tests  
2. Virtual mount (`mount/` trait): **FUSE** (Linux) + **WinFsp** (Windows) — `workspace/` → `store/` (`encrypted_dir`)  
2b. `plain/` module: real `workspace/` extract → close + `secure_wipe_workspace`  
3. open/close happy path without UI — **both modes** (Linux + Windows)  
4. Recovery detector  
5. `7z t` gate before write  
6. Electron minimal UI (vault list, lock/unlock, modals)  
7. Linux packaging (`7zz`, AppImage via electron-builder)  
8. Windows packaging (`7zz`, `.exe`, WinFsp deps)  
9. Later: macOS, RN Android, iOS  

Current scaffold: step 1 barely started (`app_version` only).

---

## Commands

```bash
# From dev/
nvm use
npm install --prefix apps/desktop
npm install --prefix apps/electron
npm run dev --prefix apps/desktop          # Vite http://localhost:1420
npm run electron:dev                       # Electron + upriv-daemon
cargo test -p upriv-core
npm run rust:lint                          # rustfmt --check + clippy
npm run rust:fix                           # rustfmt + clippy --fix
./run lint                                 # all linters (TS + Rust)
./run lint-fix                             # auto-fix where supported
./run test                                 # cargo test --workspace
./run check                                # lint + test
cargo build -p upriv-daemon --release

# Mobile
npm install --prefix apps/mobile
npm run start --prefix apps/mobile
npm run typecheck --prefix apps/mobile
```

---

## Coding guardrails

1. **Language:** English for docs, code comments, logs, TOML comments, commit messages. UI text = **i18n keys** in `dev/apps/shared/locales/*.json` only (`LOCALE.md`).
2. **Minimize scope:** Smallest correct change; match existing style; no drive-by refactors.
3. **Security:** No passwords/secrets in logs, commits, or UI persistence. Use `zeroize` in Rust for sensitive buffers.
4. **Config:** TOML is source of truth; mutable at runtime; re-read before open/close.
5. **Fail safe:** No overwrite of main `.7z` without `7z t` / validation and atomic rename.
6. **Git:** Never commit `dev/target/`, `node_modules/`, `dist/`, `.env`, large binaries. Commit `Cargo.lock` in workspace.
7. **Design:** Do not ship `stitch_upriv_vault_manager/code.html` as the app; use PRD §3.7 + SDD §8.2 + i18n.

---

## Platform phases (PRD §3.5)

| Phase | Platform | UI | Core delivery |
|-------|----------|-----|----------------|
| **v1** | Linux + Windows desktop | Electron + React | `upriv-core` + FUSE (Linux) / WinFsp (Windows) |
| v1.1 | macOS | Electron + React | Platform mount |
| v2 | Android | React Native | `libupriv_core.so` + SAF |
| v3 | iOS | React Native | Same core, document picker |

Vault **format** is cross-platform from day one; **v1 desktop app** ships on **Linux and Windows**.

---

## Mobile packaging (future)

One **APK** = JS bundle + RN runtime + **`libupriv_core.so`** + `7zz` + JNI bridge. Mobile uses React Native, not Electron. Expo Go does **not** load custom Rust; need dev build when bridge exists.

---

## Desktop shell hardening — agent mindset

Upriv is an **offline desktop app**: valuable data lives on the **client’s PC**, not on Upriv servers. Shell controls (allowlist, CSP, stdio, graceful shutdown) are **not** “bank-grade remote security” — they are **product engineering** for boundaries, stability, and predictable development.

**Why keep them (default: keep, do not strip without reason):**

| Mechanism | Primary benefit | Not the main goal |
|-----------|-----------------|-------------------|
| stdio NDJSON (no TCP) | No open port; simple cross-platform transport | Blocking remote hackers |
| IPC routing | Electron forwards to daemon; **`rpc.rs` match** is the method gate | Paranoid XSS defense |
| `SHELL_COMMANDS` vs `DAEMON_COMMANDS` | Clear split: Electron vs Rust responsibilities | — |
| `app_shutdown` + `before-quit` | **Stability** — clean daemon exit, future vault flush | — |
| Single-instance lock | One app / one daemon — no lockfile fights | — |
| Structured RPC errors `{ code, message }` | UI/i18n consistency | — |
| CSP (production only) | Extra renderer boundary; low cost | Required in dev (Vite breaks) |
| `contextIsolation` + preload | Standard Electron — renderer cannot touch Node/fs | Optional extra |

**Real vault security** lives in **`upriv-core`**: crypto, RAM session, lockfiles, wipe, 7z gate. The shell must not implement vault logic — only enforce **clear edges** between React, Electron main, and `upriv-daemon`.

**When adding RPCs:** add core op names to `@upriv/shared` `CORE_RPC_COMMANDS`, daemon-only ops to `DESKTOP_ONLY_RPC_COMMANDS`, handler in `rpc.rs`, helper in `lib/rpc.ts`. Shell-only ops (`app_exit`) go in `SHELL_ONLY_RPC_COMMANDS` / Electron `main.ts` — never `rpc.rs`.

**When adding errors:** User-visible → `<domain>/errorMessages.ts` (or grouped files under a subfolder per §4.1). Domain `index.ts` re-exports only symbols used outside. See `ARCHITECTURE.md` §2.4.

**Do not assume** every hardening layer is mandatory for “security compliance.” **Do assume** removing allowlist/stdio/shutdown without replacement will hurt **maintainability and stability** as vault features land.

**Performance / universality:** these checks are negligible (Set lookups, headers). They do **not** block Linux/Windows/macOS or Android (JNI uses a different bridge, same RPC **contract**).

Details: [`dev/docs/ARCHITECTURE.md`](../dev/docs/ARCHITECTURE.md) §2.4.

---

## What agents should avoid

- Implementing vault/crypto in `apps/desktop/` or `upriv-daemon/` instead of `upriv-core`
- Adding Electron or HTTP server deps to `upriv-core`
- Hardcoding Portuguese/English UI strings in TS/Rust
- Treating `workspace/` as a normal data folder in `encrypted_dir` (virtual mount)
- Comparing `archive_hash` with `store_hash` for sync (use `sync_generation`)
- Copying desktop JSX verbatim to React Native
- Committing build artifacts under `target/`
- Using Stitch HTML as production UI without i18n keys

---

## Quick PRD index

- §1 Vision, modes, states, v1 flow  
- §2 Use cases  
- §3 Functional requirements (+ §3.6 Android, §3.7 Desktop UX)  
- §4 Password/session modes  
- §5 Vault structure  
- §6 NFR (Rust core, UI presentation-only)  
- §9 Roadmap  

## Quick SDD index

- §1 Principles + diagram  
- §2 State machine  
- §3 Files + TOML  
- §4 `upriv-core`  
- §5 7-Zip  
- §6 Session  
- §7 Recovery  
- §8 Desktop UI spec  
- §9 Mobile  
- §14 Implementation order  
- §15 ADRs  

---

*Keep this file aligned when stack or layout changes. Update `dev/docs/VERSIONS.md` when pins change.*
