# Upriv — AI agent context

**Product:** portable encrypted vault manager (`store/` at rest; export a `.zip` of that ciphertext or a `.7z`).  
**Repo:** monorepo with `dev/` (implementation), `prod-example/` (static vault-root demo — **layout is stale**; see that folder’s README).  
**Status:** v0.2-beta — Electron desktop + Expo mobile; vault-root / settings / **vault list + create + open/close**, **in-app file manager**, **Linux FUSE**, **zip/7z export**, **import**, and **backups** talk to `upriv-core` (`store/` wrap + index + chunks, `format_version` 1 only). WinFsp is still a stub. Change-password is **not** implemented. Portable `.7z` export/import pack and unpack logical files **in RAM** (export fails closed if RAM is insufficient); zip of `store/` is always available.

**Greenfield.** `dev/` is the first product, not a successor. Nothing older shipped. One store format (`format_version` 1). One backup file (`backups/<stamp>-<id>.zip`). Do not add a reader, migrator, or dual path for drafts, Seal, `archive/`, unpacked backup folders, `.7z` backups, or demo trees. If a doc, review, or example still describes an older layout, ignore it and implement the current path only — no compatibility shim beside the real one. [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md) states that rule and **wins** over stale PRD/SDD sections.

---

## CRITICAL — no durable plaintext on disk (`encrypted_dir`)

**Read before any vault open/close/mount/7z/store work:** [`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md).

| Fact | Detail |
|------|--------|
| **Product promise** | Default mode never leaves decrypted vault files on HD/SSD (PRD RF-45, RF-49; SDD §2.6). |
| **`dev/` today** | Vault create/open/close persist **`store/`**. Live in-app file manager (`vault_fs_*`) + Linux FUSE; zip export of `store/`; `.7z` export/import in RAM (no plaintext disk). Export of a vault requires **that** vault closed; file zip/7z import and create-from-backup may run while other vaults stay open. Change-password is not implemented. RF-49 still applies to every new I/O. |
| **`temp/upriv/` (research snapshot)** | FUSE session OK; **close/materialize/password/recovery write full plaintext trees to OS tempfile** via `export_logical_tree` + `create_from_dir`. **Do not port that pattern.** |
| **Ship blocker** | Real open/close must persist **`store/`** without a plaintext tree on disk. Export/import `.7z` pack and unpack logical content in RAM (fail if RAM is insufficient). No `DevPlaintext` in user builds. No `7zz -p` on argv. |
| **Exception** | `upriv_plain` may use real `workspace/` plaintext **with** UI warning + wipe — never confuse with default mode. |

**Agent rule:** if implementing close/export and the easy path is “extract/export to tempfile then `7zz a`”, **stop** — that violates the core trust claim. Transitional phases (import, crash leftover) are still disk. See checklist in `SECURITY-PLAINTEXT.md`.

---

## Current development phase (read this first)

We are **past the Tauri → Electron migration** and **past UI/lifecycle scaffolding**. Vault-root / settings / **vault list + create + open/close**, **in-app file manager**, **Linux FUSE**, **export/import**, and **backups** talk to **`upriv-daemon`**. WinFsp is still a stub. Change-password is not live.

| Layer | State in `dev/` (active) |
|-------|---------------------------|
| **React UI** | Vault list / create / open-close / in-app file manager / export live via daemon; settings + **`VaultRootGate`** / setup / repair use live vault-root + app-settings. Desktop has no in-memory vault mocks. |
| **Mobile UI** | Expo RN: Gate + list + lifecycle/settings/backups/in-app FM; **Expo Go = mocks**; **dev-client = `upriv-ffi`** for vault-root/settings/logs/vault I/O (no FUSE) |
| **Electron** | Shell, preload, daemon spawn, IPC timeouts, packaging scaffold |
| **upriv-rpc / upriv-ffi** | Shared CORE RPC handlers; UniFFI `invoke` + Expo module `modules/upriv-core` |
| **upriv-daemon** | stdio JSON-RPC — thin wrapper over `upriv-rpc` (same handlers as mobile) |
| **upriv-core** | `logging`, `time`, `app_version()`, **`paths/`**, **`config/`**, **`store/`** (Argon2id wrap + AES-SIV index + XChaCha chunks), **`vault/`** list / create / open / close / rename / fs / export / import / backup, **Linux FUSE** (WinFsp stub) |
| **Integration** | Desktop: `createDesktopServices()` → live root/settings/logs/vaults/FM/export; Mobile: `createServices()` → native if bridge linked, else mocks |

**What to build next (default order):**

1. WinFsp mount on Windows (Linux FUSE already live)  
2. Change-password (not implemented; keep the current chunk AAD, which does not bind KDF params)  
3. Remaining RPCs from SDD §8.2–8.3  
4. SAF-backed vault I/O on Android (currently filesystem vault-root only)  

Vault list / create / open / close + groups are already live. **Do not** re-implement vault logic in TypeScript.  
**Do not** reimplement vault-root resolution in TS — use existing `vault_root_*` RPCs / `VaultRootService`.  
**Do not** ship infinite loading overlays — every blocking busy/applying UI uses `LOADING_BUDGET_MS` + visible countdown (`LoadingBudgetHint` / `useLoadingBudget`); on timeout clear state, bump generation tokens (`busyGen` / `resolveGen`), and offer retry. See `.cursor/rules/finite-loading-budgets.mdc`.  
**Do not** leave **Info** modals stale when changing settings, vault DTOs, root paths, or diagnostics mocks — extend `domain/system-info` / `domain/vault-info` in the same change. See `.cursor/rules/info-modals-sync.mdc`.

**Logging notes** (app `.log` under `.upriv/logs/` — not vault plaintext; never dump vault trees into logs or OS temp for export):

- **Format / rotation / names:** canonical contract in [`prod-example/README.md`](../prod-example/README.md) § Logs; keep Rust `logging/format.rs` and `@upriv/shared` `domain/logs/format.ts` in sync.
- **`log_event` is lazy:** with no vault-root yet it does not write under `.upriv/logs/` (stderr/`eprintln` only).
- **Allowlisted UI `log_event`s** (no id/name/path fields): `vault_hidden`, `vault_group_hidden`, `ui_crash`, `import_cache_wipe_failed`.
- **Session clear:** NeedsSetup / incomplete / missing root clears the process logger so a stale writer cannot `mkdir` a fake `.upriv/logs`.
- **`ensure_logs_dir`:** never recreate a missing `.upriv`; only create the `logs` leaf after `validate_existing_vault_root`.
- **`vault_root_resolve`:** after `vault_root_ready` this process, missing marker → typed `vault_root_not_found` (**not** soft `needs_setup`). `needs_setup` is only true first-run / after A/B reset of the ready flag.
- **`log_list` / `log_get` / `log_delete`:** soft empty / soft no-op **only** true pre-ready bootstrap. After `vault_root_ready` this process, missing/corrupt root → typed A/B (`vault_root_not_found` / `incomplete` / alias), **not** `Ok([])` (that would look like “no log files”).
- Contrast with **settings save:** soft `wrote: false` only for empty `custom_root` bootstrap; mid-session miss is `Err`. Same integrity spine.
- `VaultRootGate` may emit a second `vault_root_resolve` DEBUG line under React Strict Mode in development; production should see one probe per settings-ready / epoch bump.

### Mid-session integrity (fail loud)

After Gate is **ready** / `settingsOnDisk`, I/O that assumes a valid contentor must not soft-succeed if that contentor is gone or corrupt.

| Case | Meaning | Wire | UI |
|------|---------|------|-----|
| **A** | `.upriv` corrupt / incomplete | `vault_root_incomplete` | Toast + bump `vaultRootEpoch` → Gate Repair |
| **B** | `.upriv` missing | `vault_root_not_found` (custom path often `vault_root_alias_invalid`) | Toast (`modal.vault_root_setup.lost`) + bump epoch → **first-run Setup** (drop RAM locale/theme/mode to defaults) |
| **C** | Root OK; `vaults/<id>` gone | `vault_not_found` | Toast + invalidate that vault session — **do not** reopen Gate |

**UI helper:** `reportVaultRootIntegrityFailure` in `AppSettingsContext` — bump `vaultRootEpoch`. If the data folder is **gone** (`vault_root_not_found` / `vault_root_alias_invalid`): reset in-memory prefs to defaults (English / default theme / `default_root`), toast `modal.vault_root_setup.lost`, Gate shows Setup — do not keep the previous locale/theme to stamp a new root, and do not open alias Recovery. Incomplete leftover still Repair (keep RAM for that path). Callers: settings persist failure, **Logs** list, **Info** (system + vault), Settings `vault_root_resolve`, Groups save, list refresh. Each reports then closes its modal — never show stale `found` / `store/` paths for A/B.

**Settings save:** missing/corrupt target → `Err` (not `wrote: false`). Soft `wrote: false` only for empty `custom_root` path (bootstrap). Pre-root UI (`onDisk: false`) keeps prefs in memory without requiring a disk write.

**Case C:** `vault_not_found` when the root is valid but `vaults/<id>` is gone — toast + invalidate that vault; **do not** reopen Gate.

**Taxonomy is layered / extensible** — A/B/C are the presence spine, not a closed set:

| Layer | Examples | UI |
|-------|----------|-----|
| Vault-root | A, B, `alias_invalid`, marker I/O | Gate Setup / Repair (`io_error` / unreadable still Recovery) |
| Vault | C, `vault_config_invalid`, archive/store broken | That vault |
| Session/ops | `wrong_password`, already open, RAM, mount | Op toast |
| Transport | disk full, permission | `io_error` |

Rule: *I/O that assumed X valid → if X is gone/corrupt, typed Err of X’s layer — never silent `wrote: false` after ready.*

---

## Research snapshot: `temp/upriv/` (local, gitignored)

The repo may contain **`temp/upriv/`** on disk — a **frozen snapshot of an older Tauri-based tree** (pre–Electron migration). It is listed in `.gitignore` and is **not** part of the active build or CI.

| Aspect | `temp/upriv/` (snapshot) | `dev/` (active) |
|--------|------------------------|-----------------|
| Desktop shell | Tauri 2 (`src-tauri/`) | Electron + `upriv-daemon` |
| `upriv-core` | Large — vault, crypto, `seven_zip`, mount, session, … | Growing: paths, config, `store/` crypto, vault list/create/open/close/fs/export/import/backup, Linux FUSE. WinFsp and change-password still not live |
| UI wiring | Often **real** Tauri commands | Live root/settings/list/create/open/close/FM/export; change-password still blocked |
| Code quality | Grew fast; **inconsistent, shortcuts, debt** | Intentional boundaries, reviews, typed errors |

**How agents may use `temp/`:**

- **OK:** Read for **ideas**, flow order, edge cases, “how did we solve X before?”, test data shapes, 7z integration sketches.  
- **OK:** Compare on-disk layout against `prod-example/` and SDD.  
- **OK:** Study FUSE ↔ encrypted store I/O as a reference for RAM-side decrypt (not for close/export).  
- **Not OK:** Copy-paste modules into `dev/` without re-reading PRD/SDD/`ARCHITECTURE.md`.  
- **Not OK:** Port `finalize_close` / `materialize_store_from_archive` / change-password **tempfile + `export_logical_tree` + `create_from_dir`** — that spills full plaintext trees to OS temp (see [`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md)).  
- **Not OK:** Treat Tauri command names, folder layout, or error handling as the contract — **active contract is `dev/` + docs**.  
- **Not OK:** Assume temp behavior matches current product rules (FIFO, i18n errors, Electron bridge, session rules may differ).

When temp and canonical docs conflict, **`dev/docs/` wins**. When porting an idea from temp, **rewrite** into the current architecture (stdio RPC, `@upriv/shared` types, domain error maps).

---

## Canonical documentation (read order)

| Priority | File | Role |
|----------|------|------|
| 0 | [`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md) | **Ship blocker** — no durable plaintext in `encrypted_dir`; anti-patterns from `temp/` |
| 0b | [`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md) | Store protocol — Argon2id + HKDF + XChaCha20-Poly1305; `.7z` is export; **two storage modes**; AAD/nonce/KDF bar |
| 1 | [`dev/docs/prd.md`](../dev/docs/prd.md) | **What** to build — requirements, UX, vault states, Android rules, non-goals |
| 2 | [`dev/docs/sdd.md`](../dev/docs/sdd.md) | **How** to build — state machine, TOML layout, `upriv-core` modules, 7z, FUSE, tests, implementation order |
| 3 | [`dev/docs/ARCHITECTURE.md`](../dev/docs/ARCHITECTURE.md) | **Stack** — React/Electron/RN, `upriv-core`, bridges, ADRs, platform matrix |
| 4 | [`dev/docs/VERSIONS.md`](../dev/docs/VERSIONS.md) | Pinned toolchains (Node, Rust, Electron, Expo) |
| 5 | [`dev/docs/LOCALE.md`](../dev/docs/LOCALE.md) | English for code/docs; UI via i18n keys only |
| 6 | [`prod-example/README.md`](../prod-example/README.md) | **STALE** historical vault-root bundle (`archive/` / Seal-era). **Not** the shipping `store/` contract — see SECURITY-CRYPTO. Prefer a fresh vault-root for development. |

**Conflict resolution:** PRD + SDD define product behavior **except** rest layout, backups, and storage modes — [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md) wins there until a dedicated PRD/SDD PR. `ARCHITECTURE.md` wins over older SDD mentions of Flutter.

---

## PRD ↔ SDD map (where to look)

| Topic | PRD | SDD |
|-------|-----|-----|
| Vision, storage modes, states | §1, §1.6–1.7 (seven modes — **stale**) | §1, §2 (stale) — **use `SECURITY-CRYPTO.md`** |
| v1 Linux + Windows scope | §1.1, §3.5 | §1.1 principle 0, §14 |
| Functional requirements (RF-*) | §3 | §2–§7, §8–§9 |
| Desktop UX (vault list, modals) | §3.7 | §8.2 |
| Android (SAF, APK, workspace on HD) | §3.6 | §9 |
| Vault folder layout, `config.toml` | §5 | §3 |
| Password / session security | §4 | §6 |
| Store crypto (Argon2id, AEAD, vs 7z) | RF-55 | §2.4.1, §6; **`.agent/SECURITY-CRYPTO.md`** |
| Non-functional (Rust core, UI boundary) | §6 (RNF-05) | §1.1, §4, §15 |
| Roadmap phases | §9 | §14 |
| `upriv-core` modules, public API sketch | §11 (glossary) | §4 |
| 7-Zip integration | (flow in §1.9) | §5 |
| Recovery | (states §1.7) | §7 |
| Implementation order for agents | §9 | **§14** (step-by-step) |
| ADR summary | — | §15 (+ `ARCHITECTURE.md` §7) |

---

## Product summary (storage / rest: SECURITY-CRYPTO wins over stale PRD/SDD)

- **At rest:** `store/` (Argon2id + XChaCha20-Poly1305). **No `archive/`.** **No Seal.** A backup is `backups/<stamp>-<id>.zip` — a Stored zip with `README.md` and `config.toml` beside `store/` (`header/`, `index/`, `data/`, `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md`), no zip password (pins: `backups/saves/<stamp>-<id>.zip`). `README.md` records the UTC time that copy was written, the same instant as `<stamp>`, and the rounded size of the files in `store/` (not the exact length of the zip). **Greenfield** — no unpacked backup tree, no `.7z` backup, no migrator from demo `archive/`+`store/`. Create-from-backup and a store `.zip` import pre-fill the wizard from that `config.toml` and write `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md` into the new `store/`. The new vault does not keep `README.md`. A `.7z` does not. Export and backup write that warning file before packing so the zip keeps it inside `store/`.
- **Argon2id:** user picks cost at create; default **256 MiB / 3 passes**; also 32 MiB (less-secure), 64 MiB, 128 MiB, 1 GiB, and 2 GiB. UI explains **security + RAM to unlock**, not device class. Header params apply everywhere — never auto-downgrade.
- **Modes:** **`encrypted_dir`** (default — plaintext in RAM only: FUSE/WinFsp on desktop, **in-app file manager on mobile**) and **`upriv_plain`** (plaintext `workspace/` on disk while open; wipe on close; **Insecure**). Dropped: `store_only`, `upriv_only`, `ram_only`, `plain`, `plain_only`. Same `store/` on every OS.
- **States:** `open` = unlocked session (runtime). Where plaintext lives is the **mode**, not the word “open”. On disk: `closed` only. **No Seal.**
- **Recovery:** dirty close (A) or leftover `upriv_plain` workspace (D). One bad chunk = file error (B). Dead header/index = create-from-backup only (C).
- **`.zip` / `.7z`:** import/export outside `.upriv`. One import option. A chosen `.zip` is examined: `store/header/vault.header` means a **zip of `store/`** (Recommended; copy ciphertext, settings kept from the root `config.toml`). Anything else is ordinary documents wrapped into a new `store/` (new password and unlock RAM; one shared top folder is stripped). A `.7z` is one outer folder named from the display name; the vault's files sit directly under that folder. It does not carry the store-zip envelope. Export is **per vault** (user chooses; store zip is default). Suggested file = `{display_name}.zip` or `{display_name}.7z`. Export requires **that** vault closed (other vaults may stay open). File zip/7z import and create-from-backup copy a frozen tree — they do not require the source vault closed. No bulk download of several vaults.
- **Compression UI:** presets none/low/medium/high apply to **export** `.7z` (`[seven_zip]`).
- **Close:** write `store/` from the session (stream / mount buffers). Export `.7z` is a separate action — stream logical content; never pack `.enc` blobs.
- **Passwords:** RAM only in v1 default; never in `localStorage`, UI config, or logs.
- **Surface anti-brute-force:** in-process; **5** failed `open`s in **60 s** → **60 s** block (resets when Upriv quits). See `SECURITY-CRYPTO.md`.

---

## Repository layout

```text
upriv/
├── .agent/                 # This file — AI project context
├── docs/gitflow/           # GitFlow spec — see also CONTRIBUTING.md / SECURITY.md at repo root
├── temp/                   # Optional local snapshot (gitignored) — see § Research snapshot
├── prod-example/           # Static demo vault-root (no build link to dev/)
├── VERSION                 # Product SemVer (sync into dev/ manifests)
├── README.md
└── dev/
    ├── Cargo.toml          # Rust workspace: upriv-core + upriv-rpc + upriv-daemon + upriv-ffi; [patch] → vendor/
    ├── Cargo.lock
    ├── vendor/             # Pinned vault crypto (Argon2 / XChaCha / AES-SIV). Refresh: MANIFEST.txt
    ├── scripts/            # version sync, Android FFI
    ├── rust-toolchain.toml # Rust 1.94.0 (pinned)
    ├── .nvmrc              # Node 22.12.0
    ├── apps/
    │   ├── desktop/        # React 18 + Vite 6 + Tailwind 3 (presentation)
    │   ├── electron/       # Electron shell (main/preload)
    │   ├── mobile/         # Expo 52 + RN 0.76 — mocks in Expo Go; `upriv-ffi` UniFFI + `modules/upriv-core` for dev-client
    │   └── shared/         # @upriv/shared — TS domain + service interfaces (no React)
    ├── crates/
    │   ├── upriv-core/     # ALL product Rust logic (API: upriv_core::)
    │   ├── upriv-rpc/      # Shared CORE RPC handlers (daemon + ffi)
    │   ├── upriv-daemon/   # Desktop stdio sidecar → upriv-rpc
    │   └── upriv-ffi/      # UniFFI cdylib for mobile (libupriv_ffi.so)
    └── docs/
        ├── prd.md
        ├── sdd.md
        ├── ARCHITECTURE.md
        ├── VERSIONS.md
        ├── LOCALE.md
        └── WINDOWS-BUILD.md
```

---

## Architecture rules (mandatory)

### Layer boundaries

| Layer | Path | May do | Must NOT do |
|-------|------|--------|-------------|
| **UI desktop** | `dev/apps/desktop/` | Render, i18n, `desktopInvoke()` | Crypto, disk I/O, vault state on disk |
| **UI mobile** | `dev/apps/mobile/` | Same; native via `upriv-ffi` when linked | Same |
| **Electron shell** | `dev/apps/electron/` | Window, spawn daemon, IPC preload | Business logic |
| **Desktop RPC** | `dev/crates/upriv-daemon/` | stdio NDJSON → `upriv-rpc` | Business logic |
| **Shared RPC** | `dev/crates/upriv-rpc/` | CORE method handlers | Electron/RN specifics |
| **Mobile FFI** | `dev/crates/upriv-ffi/` | UniFFI `invoke` / `app_version` | UI |
| **Core** | `dev/crates/upriv-core/` | Crypto, 7z, paths, state machine, FUSE, recovery | Depend on Electron |

**Desktop UI:** Electron (`createDesktopServices`) talks to `upriv-daemon` for vault-root, settings, logs, vault list/create/open/close/`vault_rename`, groups, `vault_config_save`, in-app file manager (`vault_fs_*`), export/import, and backups. There is no desktop in-memory vault list. Linux FUSE is live in core; WinFsp is still a stub. Change-password remains blocked. Notable conventions:

- **Pipeline:** `useVaultPipelineRun` enforces SDD §8.2.2 — one open/close at a time (`isRunning`). No Seal.
- **Auto-close:** at most one close per idle tick; warn toast once per vault per idle cycle; respects `isPipelineRunning`.
- **Settings ↔ list:** vault settings save goes through `vault_config_save`; list patch includes `storageMode` only (no `canSeal`).
- **Hidden until wired:** `close_on_app_exit` UI not exposed yet (`before-quit` runs daemon shutdown; vault `close_all` RPC still TODO).
- **Feature module boundaries:** each `features/vaults/*` and `features/system/*` folder has one `index.ts` — see [`dev/apps/desktop/README.md`](../dev/apps/desktop/README.md).

Electron already uses `desktopInvoke()` → `upriv-daemon` → `upriv-core` for list/create/open/close. Do not treat the renderer password `Map` as the unlock store — session keys live in `upriv-core`.

### Data flow

```text
Desktop:  React ──desktopInvoke──► upriv-daemon ──► upriv_rpc ──► upriv_core::*
Mobile:   RN ──UprivCore──► libupriv_ffi.so ──► upriv_ffi::invoke ──► upriv_rpc ──► upriv_core::*
Mobile:   RN     ──JNI/FFI──► libupriv_core.so ──► upriv_core::*   (v2+)
```

### Rust workspace

- Build from `dev/`: `cargo build -p upriv-daemon`, `cargo test -p upriv-core`, `npm run rust:lint` (rustfmt + clippy).
- Vault crypto crates live in **`dev/vendor/`** (`[patch]`). Refresh is the checklist in `dev/vendor/MANIFEST.txt`; do not `cargo generate-lockfile`. See [`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md) agent rule 2.
- Artifacts go to **`dev/target/`** only — **never commit** `target/`, `node_modules/`, `dist/`, `.expo/`.
- `upriv-daemon/src/main.rs` is entry only; do not add vault logic there — use `upriv-core`.

### Planned `upriv-core` modules (SDD §4.2)

Rest layout and crypto bar: [`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md). No Seal, no durable `archive/` twin.

```text
upriv-core/src/
├── lib.rs
├── config/       # app settings.toml + vaults/*/config.toml (load)
├── vault/        # list / create / open / close / rename (recovery / rewrap later)
├── seven_zip/    # in-RAM .7z pack/unpack (export/import only — not rest)
├── session/      # RAM session, security modes
├── recovery/     # dirty close / leftover upriv_plain workspace
├── paths/        # VaultRoot + store/ paths
├── mount/        # Virtual workspace trait; FUSE (Linux), WinFsp (Windows)
├── store/     # At-rest ciphertext (header + index + chunks)
├── plain/        # upriv_plain workspace open/close + secure_wipe (v1)
└── sync/         # content_hash, last_close_ok_at (no archive_hash)
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

Marker: **`.upriv/settings.toml`** at vault-root. Per-vault: **`vaults/<vault_id>/`** (`vault_id` = normalized slug). Canonical detail: [`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md).

| Path | Purpose |
|------|---------|
| `.upriv/settings.toml` | App/drive settings |
| `.upriv/state.json` | Open sessions only (volatile) |
| `.upriv/vaults/<id>/config.toml` | Vault config (list/name/policy; no password) |
| `.upriv/vaults/<id>/persistence.json` | Persisted `closed` only (+ sync metadata; **no `sealed`**) |
| `.upriv/vaults/<id>/store/` | Vault body at rest (`header/vault.header` + `header/vault.header.copy` + `index/root.idx.enc` + `index/root.idx.enc.copy` + `data/`) |
| `.upriv/vaults/<id>/backups/<stamp>-<id>.zip` | Frozen Stored zip of `store/` (pins under `backups/saves/`) |
| `{path}/workspace/{display_name}/` | Folder while open when the vault follows the app folder. `workspace` holds every open file manager folder there. A vault's own folder mounts at `{path}/{display_name}/` instead. Encrypted: an empty vault path needs the app file manager folder and a chosen place. A vault with its own path needs `custom_file_manager_folder` only. Plain text still uses `workspace`. Not created at vault-root init. Linux FUSE is the live folder. |

Portable `.zip` of `store/` and `.7z` are **export/import files**, not modules under `vaults/<id>/`.

### Workspace

Distinct from vault-root / `store/`. One folder per system, because `settings.toml` travels with the data folder. All five rows are visible; only the current system can be edited.

| Store | Fields | Role |
|-------|--------|------|
| `.upriv/settings.toml` | `[workspace]` `file_manager_folder` | One encrypted-folder flag for every system. Starts off. A phone save keeps it. Unset on one system does not clear it. |
| `.upriv/settings.toml` | `[workspace.<os>]` `place` + `path` | `place` is `unset`, `beside`, or `custom`. Starts `unset`. All five systems. |
| `vaults/<id>/config.toml` | `[mount]` `app_file_manager_folder` + `custom_file_manager_folder` | Two choices for every system. `app_file_manager_folder` is `inherit`, `on`, or `off` for Use the app folder and starts `inherit`. `custom_file_manager_folder` is the Another folder switch and starts off. |
| `vaults/<id>/config.toml` | `[mount.<os>]` `path` | Empty path follows the app place. The vault screen does not store `place`. |

`unset` is the start: nothing is created, and plain text has no folder until the user chooses. `beside` creates `<data folder>/workspace/{vault name}`, next to `.upriv`. `custom` uses `{path}/workspace/{vault name}`. A vault's own folder uses `{path}/{vault name}` at that folder's root. A missing `place` with an empty path reads as `unset`. A missing `place` with a path reads as `custom`. `workspace` is where every app-folder file manager folder lives. Paths stay per system. The app stores one `file_manager_folder`. A vault stores `app_file_manager_folder` and `custom_file_manager_folder` once. The screen calls this the file manager folder. It runs only on desktop, and only when that system's place is chosen. An empty vault path follows the app place and needs the app file manager folder on, unless this vault set `on` or `off`. `app_file_manager_folder` is `inherit`, `on`, or `off` and starts as `inherit`. `on` still needs a chosen place. An own path uses `custom_file_manager_folder`, which starts off and creates that vault's folder on its own. Both choices stay saved when you switch folders. Opening an encrypted vault never waits for a folder. The in-app file manager is always available. Plain text uses the chosen place as the real folder and ignores `file_manager_folder`. Linux is the live folder; Windows and macOS save the flag until their folder exists. Phones never show a file manager folder and never mount one. A phone save keeps the shared flags.

Do not create the folder at vault-root init. Paths under `.upriv/` are reserved. The gate does not validate workspace; save does.

**`prod-example/`** is a **stale** historical bundle (`archive/` + Seal demos). Do **not** copy its layout into `dev/`. For local testing against a real tree, prefer a fresh vault-root or set `UPRIV_VAULT_ROOT` knowingly.

**Naming:** `vault_id` normalized; `display_name` keeps user spelling; export suggested filename = display name (minimal sanitize for the OS save dialog only).

### Vault-root discovery (launch)

Order in `upriv-core` `paths::resolve_vault_root`:

1. Explicit path (`--vault` / `UPRIV_VAULT_ROOT` / caller) when valid — **overrides** wire `vault_root_mode` / path  
2. **`custom_root` mode** (`vault_root_mode = custom_root`): read **active** `.upriv-root` in the app home. Alias exists **only** in this mode; inactive alias → NeedsSetup.  
3. **`default_root` mode** (default): search from `default_root` anchor then cwd; **ignore** alias  
4. Nothing found → UI setup modal: create default structure at the `default_root` (no alias) **or** choose another folder (write/rewrite `.upriv-root`). Switching back to `default_root` **deactivates** the alias (`status=inactive`, path kept — file is not deleted); changing the custom path **rewrites** it.

**`default_root` anchor:**

| Launch | Distribution | App home (`.upriv-root`) | Default vault folder (`default_root`) |
|--------|--------------|--------------------------|----------------------------------------|
| `npm run electron:dev` | `dev` | `dev/` via `UPRIV_DEFAULT_ROOT_ANCHOR` | Same as app home |
| Packaged AppImage / portable exe | `portable` | Beside binary / `$APPIMAGE` | Same as app home |
| Packaged system install (`.deb`, NSIS, macOS DMG, …) | `installed` | User data (`~/.local/share/upriv`, …) | Same as app home |

**Portable packaging exists only on Linux (AppImage) and Windows (portable exe).** macOS is always `installed` (Application Support). Android (later) has no portable mode — app sandbox / SAF only. See `dev/README.md` packaging matrix.

Electron sets `UPRIV_DISTRIBUTION` + `UPRIV_DEFAULT_ROOT_ANCHOR`. Desktop first-run UI defaults to **`default_root`** (beside the app when portable; user data dir when installed, including a writable Windows install directory). Android first-run starts on **Documents/Upriv**. `custom_root` mode still writes `.upriv-root` in app home. Rust `suggested_vault_root()` (`~/Documents/Upriv`) is exposed as daemon RPC `vault_root_suggested_custom_path` for the custom folder picker. Packaged **macOS is always `installed`**. **Portable remains the product default** when only an anchor is set (USB/HD-first), unless the anchor already matches the OS user-data home.

`prod-example/` is **not** auto-discovered by `electron:dev` (strict `UPRIV_DEFAULT_ROOT_ANCHOR=dev/`). It is stale vs greenfield `store/` — use only as a discovery smoke fixture or with eyes open (`UPRIV_VAULT_ROOT=…/prod-example`).

### Selecting an existing `.upriv`

When selecting an already-valid vault-root, **do not change** that folder’s `.upriv/settings.toml` — only update the alias (or deactivate it) and reload UI prefs from disk.

Pre-root UI prefs are carried by the **bootstrap prefs bag** — a named payload distinct from the vault-root directory: `VaultRootBootstrapPrefs` in Rust (`upriv-core`) and TS (`@upriv/shared`), nested under `bootstrap` on the daemon wire (never a top-level peer of `path` / `replaceIncomplete`). Today the only pre-root pref is UI locale (Gate selector); future entries (theme, high-contrast, etc.) extend the same bag without renaming setup APIs. Bootstrap prefs seed the new `settings.toml` **only when creating** a new `.upriv` (or incomplete→replace) — the daemon ignores them on a Valid target so opening never rewrites another vault-root's UI prefs. **System settings** Save edits the **active** root only; switch/create data folder via the vault-list **⋯ → Data folder** modal (not inside System settings).

**Data folder switch:** UI blocks apply while any vault is not `closed` / `recovery` (also `opening` / `closing` / `creating`). Modal stays open read-only — no bulk-close. Core refuses `vault_root_setup_*` with `vault_root_busy` while a session is open, mid-close flush, or Argon2 unlock/create holds the process gate.

**Config edit policy:** `@upriv/shared` `domain/edit-policy` (contract `edit-policy.json`) is the table for what may change while a vault is busy (`anytime` / `vault_quiet` / `vault_closed` / `vault_closed_or_recovery` / `root_idle` / `no_open_session`). Hybrid default: list/next-close prefs anytime; mount / storage / `security.mode` need **quiet** (no open/opening/closing; recovery OK; **creating and queued-open are still quiet** at this gate); `vault.display_name` / `vault.id` need **closed or recovery** (not creating/queued — those wait on create Argon2 or a queued open). Change-password / KDF need **strictly closed** (not recovery). App targets stay coarse (`ui` / `logging` / …) until fine field locks are needed. SDD §3.2.3 “open or closed” for rewrap is **deprecated**. Rewrap still unavailable in core until SECURITY-CRYPTO P0. **Rust** `save_vault_config_checked` / RPC `vault_config_save` refuse quiet-gated field changes (mount / storage / `security.mode`) while the session is open, mid-close, or Argon2 is in flight (`vault_config_busy`) — same targets as `rustConfigSaveQuietTargets` in the JSON contract (UI may also refuse edits while list status is **opening** — that is pipeline UX, not the quiet predicate). Display name and folder id change **only** via RPC `vault_rename` (never `vault_config_save`; a live save of those fields is `VaultConfigInvalid`). `rename_vault` also refuses while this vault is open, mid-close, or preparing (open/create seed). Quiet gate allows creating and a queued open on a closed vault. A queued close on an open session is not quiet. Waiting close shows `queued` until it starts; waiting create stays `creating`. Row UI usually hides settings while pipeline-busy. Locked-field copy comes from `lockedI18n` in that contract (`vaultConfigEditLockedI18nKey`).

---

## v1 implementation order (SDD §14)

Work in this order unless the user explicitly reprioritizes:

1. `upriv-core`: config load, paths, `SevenZip` wrapper + tests — **include `create_from_logical` / stream path; do not ship directory-only close that needs plaintext staging** (RF-45)  
2. Virtual mount (`mount/` trait): **FUSE** (Linux) + **WinFsp** (Windows) — `workspace/` → session over `store/` (`encrypted_dir`)  
2b. `plain/` module: real `workspace/` extract → close + `secure_wipe_workspace`  
3. open/close happy path without UI — **both modes** (Linux + Windows); **RF-49/RF-45 tests are part of “done” for encrypted_dir close** — see [`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md)  

4. Recovery detector (dirty close / leftover `upriv_plain` workspace — not Seal)  
5. Export/import: zip of `store/` + portable `.7z` (no durable twin)  
6. Electron minimal UI (vault list, lock/unlock, modals)  
7. Linux packaging (`7zz`, AppImage via electron-builder)  
8. Windows packaging (`7zz`, `.exe`, WinFsp deps)  
9. Later: macOS, RN Android, iOS  

Current scaffold: vault list / create / open / close / `vault_rename` + groups + `vault_config_save` + in-app file manager + Linux FUSE + zip/7z export/import + backups are live on Electron and native FFI (filesystem vault-root only). **Next:** WinFsp, then change-password. See § Current development phase. **Do not** re-implement list/create/open/close/rename in TypeScript.

**Import:** desktop native picker + `vault_import_probe` (live). OS drop still pre-fills the create wizard when the shell provides a path.

---

## Commands

```bash
# From dev/
nvm use
npm install --prefix js-lint               # ESLint + Prettier (JS/TS, once)
npm install --prefix apps/shared
npm install --prefix apps/desktop
npm install --prefix apps/electron
npm run dev --prefix apps/desktop          # Vite http://localhost:1420
npm run electron:dev                       # Electron + upriv-daemon
./run desktop                              # wipe Vite cache, then electron:dev
./run mobile                               # wipe Metro/Expo cache, then expo start --clear
./run mobile --android                     # same, open Android
cargo test -p upriv-core
npm run rust:lint                          # rustfmt --check + clippy
npm run rust:fix                           # rustfmt + clippy --fix
./run lint                                 # all linters (TS + Rust)
./run lint-fix                             # auto-fix where supported
./run test                                 # cargo test --workspace + shared/desktop vitest
./run check                                # lint + test
cargo build -p upriv-daemon --release

# Mobile
npm install --prefix apps/mobile
./run mobile                               # from dev/; or npm run start --prefix apps/mobile
npm run typecheck --prefix apps/mobile
```

---

## Coding guardrails

1. **Language:** English for docs, code comments, logs, TOML comments, commit messages. UI text = **i18n keys** in `dev/apps/shared/locales/*.json` only (`LOCALE.md`).
2. **Minimize scope:** Smallest correct change; match existing style; no drive-by refactors.
3. **Security:** No passwords/secrets in logs, commits, or UI persistence. Use `zeroize` in Rust for sensitive buffers.
4. **Config:** TOML is source of truth; mutable at runtime; re-read before open/close.
5. **Fail safe:** No overwrite of `store/` without verification and atomic write.
6. **Git:** Read [`GIT.md`](GIT.md) before commit/PR. Never commit `dev/target/`, `node_modules/`, `dist/`, `.env`, large binaries. Commit `Cargo.lock` in workspace. **Never** set the AI as Git author or co-author — use Git’s effective `user.name` / `user.email` (local if set, else global). After each commit, verify identity and that the message has no AI credit. After every PR create or edit, read the body and delete a `Made with Cursor` / `Made with [Cursor](https://cursor.com)` footer if the host appended one.
7. **Design:** Shipped UI follows PRD §3.7 + SDD §8.2 + i18n.

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

### Android data folder

The Android default data folder is **Documents/Upriv**. `.upriv/` is not created in the private app folder. App-specific storage (`filesDir`, and `Android/data/<package>/`) needs no confirmation and is deleted on uninstall, including a directory created there under a Documents name. Shared Documents stays after uninstall, and Android requires one system confirmation before the app can create it. The system screen opens on Documents, which already exists, so confirming it is the step. Upriv creates the `Upriv` folder inside that grant, and the vault lives there. The persisted grant is Documents: Android will not grant a folder that does not exist yet, and it will not narrow a parent grant. Rust addresses the data folder as `/upriv-saf-root` (the `Upriv` child of a Documents grant, or the tree itself when the grant is already `Documents/Upriv`). The private app folder (`filesDir/upriv`) keeps the folder pointer, not the vault tree. The saved grant stays in private storage and disappears with the app. The ciphertext stays. On the next install the user confirms the same folder; an existing `.upriv` is opened as-is. If the app folder already has `.upriv` and the granted folder does not, the tree is copied and the app-folder copy is removed only after the copy matches. If the granted folder already has `.upriv`, both stay. A `.upriv` found only in the private app folder is not opened as the data folder; setup asks for Documents/Upriv and then copies it. Do not copy a vault into `filesDir` or OS temp to fake a mount.

- Do **not** request `MANAGE_EXTERNAL_STORAGE`. Do not treat `/storage` or `/sdcard` as a path Rust can open.
- Mount the grant before any path RPC while that folder is the data folder. A leftover grant is dropped when the alias is not `/upriv-saf-root`.
- Android setup confirms Documents. The data folder created inside it is Documents/Upriv. Desktop custom paths stay filesystem paths. A Windows installer uses the user-data directory even when the install folder is writable. Portable exe and AppImage stay beside the program.
- A picker result that cannot host vaults fails at selection time and does not become the active root.
- Encrypted open does not create or require a workspace folder. A phone path, if the user sets one, is a storage-access document URI (`…/tree/<id>/document/<id>%2F…`), not `<tree-uri>/workspace`. A Documents grant would use `…/document/<id>%2FUpriv%2F…`, because the data folder is the `Upriv` child. The private app folder is not a workspace.

---

## Desktop shell hardening — agent mindset

Upriv is an **offline desktop app**: valuable data lives on the **client’s PC**, not on Upriv servers. Shell controls (allowlist, CSP, stdio, graceful shutdown) are **not** “bank-grade remote security” — they are **product engineering** for boundaries, stability, and predictable development.

**Why keep them (default: keep, do not strip without reason):**

| Mechanism | Primary benefit | Not the main goal |
|-----------|-----------------|-------------------|
| stdio NDJSON (no TCP) | No open port; simple cross-platform transport | Blocking remote hackers |
| IPC routing | Electron forwards allowlisted methods to daemon; **`rpc.rs` match** is the product method gate; `ipcMain.handle` also rejects unknown names | Paranoid XSS defense |
| `SHELL_COMMANDS` vs `DAEMON_COMMANDS` | DX split: Electron vs Rust responsibilities (also enforced in `main.ts` allowlist) | — |
| `app_shutdown` + `before-quit` | **Stability** — clean daemon exit, future vault flush | — |
| Single-instance lock | One app / one daemon — no lockfile fights | — |
| Structured RPC errors `{ code, message }` | UI/i18n consistency | — |
| CSP (production only) | Extra renderer boundary; low cost | Required in dev (Vite breaks) |
| `contextIsolation` + preload | Standard Electron — renderer cannot touch Node/fs | Optional extra |

**Real vault security** lives in **`upriv-core`**: crypto, RAM session, lockfiles, wipe, 7z gate. The shell must not implement vault logic — only enforce **clear edges** between React, Electron main, and `upriv-daemon`.

**When adding RPCs:** add core op names to `@upriv/shared` `CORE_RPC_COMMANDS`, daemon-only ops to `DESKTOP_ONLY_RPC_COMMANDS`, handler in `rpc.rs`, helper in `lib/rpc.ts`, **and** the Electron `ALLOWED_IPC_METHODS` set in `apps/electron/src/main.ts`. Shell-only ops (`app_exit`, `pick_directory`) go in `SHELL_ONLY_RPC_COMMANDS` / Electron `main.ts` — never `rpc.rs`.

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
