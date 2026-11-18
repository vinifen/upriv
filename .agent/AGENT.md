# Upriv — AI agent context

**Product:** portable encrypted vault manager (`store/` at rest; export a `.zip` of that ciphertext or a `.7z`).  
**Repo:** monorepo; the implementation lives in `dev/`.  
**Status:** v0.2-beta — Electron desktop + Expo mobile; vault-root / settings / **vault list + create + open/close**, **in-app file manager**, **per-device folder lists** (data folder, unlocked folders, backup folders), **Linux FUSE**, **Windows WinFsp** (Windows packages carry the official installer and ask when encrypted vaults' unlocked folders are turned on, or when an encrypted vault's attach finds the driver missing; declining leaves the switch unchanged, or the vault in the in-app file manager. Linux asks to install the distro `fuse3` package at those same moments. `upriv-daemon` does not link `libfuse`; the AppImage starts without system `libfuse2`), **zip/7z export**, **import**, and **backups** talk to `upriv-core` (`store/` wrap + index + chunks, `format_version` 1 only). A missing WinFsp DLL or a missing `fuse3` fails only the unlocked folder; the in-app file manager still works. The storage mode is sealed in the vault's index and changes only on the Storage screen with the password (`vault_change_storage`); `config.toml` holds a copy, and a copy that differs opens the vault encrypted. Password change and unlock-RAM change are jobs on a closed vault (`vault_change_password`, `vault_change_kdf`): a password change makes a new key and rewrites every file with it, batch by batch, behind an optional start backup (**Back up first**), with Finish for one a crash left unfinished (`vault_password_change_finish`); an unlock-RAM change keeps the keys and updates every blob's key copy. Every blob carries a key copy of its header block, so the rebuild brings back a lost header as well as a lost index. Delete vault is a job with its own window and Delete now. Portable `.7z` export/import pack and unpack logical files **in RAM** (export fails closed if RAM is insufficient); zip of `store/` is always available.

**Greenfield.** `dev/` is the first product, not a successor. Nothing older shipped. One store format (`format_version` 1). One backup file (`<stamp>-<id>.zip`). Do not add a reader, migrator, or second path for any other layout — implement the current path only, with no compatibility shim beside it. [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md) states that rule and **wins** over PRD/SDD for rest layout, backups, and storage modes. Code, comments, tests, and docs describe only the current behavior, and a change deletes what it leaves unused: [`rules/greenfield.md`](rules/greenfield.md).

---

## CRITICAL — no durable plaintext on disk (`encrypted_dir`)

**Read before any vault open/close/mount/7z/store work:** [`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md).

| Fact | Detail |
|------|--------|
| **Product promise** | Default mode never leaves decrypted vault files on HD/SSD (PRD RF-45, RF-49; SDD §2.6). |
| **`dev/` today** | Vault create/open/close persist **`store/`**. Live in-app file manager (`vault_fs_*`) + Linux FUSE; zip export of `store/`; `.7z` export/import in RAM (no plaintext disk). Export of a vault requires **that** vault closed; file zip/7z import and create-from-backup may run while other vaults stay open. Password and unlock-RAM change also require that vault closed; a password change rewrites every file chunk by chunk in RAM, never through a plain-text file. RF-49 still applies to every new I/O. |
| **`temp/upriv/` (research snapshot)** | FUSE session OK; **close/materialize/password/recovery write full plaintext trees to OS tempfile** via `export_logical_tree` + `create_from_dir`. **Do not port that pattern.** |
| **Ship blocker** | Real open/close must persist **`store/`** without a plaintext tree on disk. Export/import `.7z` pack and unpack logical content in RAM (fail if RAM is insufficient). No `DevPlaintext` in user builds. No `7zz -p` on argv. |
| **Exceptions** | `upriv_plain` may write real plaintext into its unlocked folder **with** UI warning + wipe — never confuse with default mode. A plain-text `.zip` export is the readable file a person chose behind the vault password and a red warning, so they can always take their data out; its `.upriv-part` is wiped on a stop, a failure, or the launch after a crash. |

**Agent rule:** if implementing close/export and the easy path is “extract/export to tempfile then `7zz a`”, **stop** — that violates the core trust claim. Transitional phases (import, crash leftover) are still disk. See checklist in `SECURITY-PLAINTEXT.md`.

---

## Current development phase (read this first)

Vault-root / settings / **vault list + create + open/close**, **in-app file manager**, **Linux FUSE**, **Windows WinFsp**, **export/import**, and **backups** talk to **`upriv-daemon`**. Without `fuse3` or the WinFsp runtime the vault still opens and the in-app file manager is the folder. Password and unlock-RAM change are live (`vault_change_password`, `vault_change_kdf`).

| Layer | State in `dev/` (active) |
|-------|---------------------------|
| **React UI** | Vault list / create / open-close / in-app file manager / export live via daemon; settings + **`VaultRootGate`** / setup / repair use live vault-root + app-settings. Desktop has no in-memory vault mocks. |
| **Mobile UI** | Expo RN: Gate + list + lifecycle/settings/backups/in-app FM; **Expo Go = mocks**; **dev-client = `upriv-ffi`** for vault-root/settings/logs/vault I/O (no FUSE) |
| **Electron** | Shell, preload, daemon spawn, IPC timeouts, packaging scaffold |
| **upriv-rpc / upriv-ffi** | Shared CORE RPC handlers; UniFFI `invoke` + Expo module `modules/upriv-core` |
| **upriv-daemon** | stdio JSON-RPC — thin wrapper over `upriv-rpc` (same handlers as mobile) |
| **upriv-core** | `logging`, `time`, `app_version()`, **`paths/`**, **`config/`**, **`store/`** (Argon2id wrap + AES-SIV index + XChaCha chunks), **`vault/`** list / create / open / close / rename / fs / export / import / backup, **Linux FUSE** (`libupriv_fuse.so` loaded at mount; `fuse3` is asked when the folder is turned on; declining leaves the switch), **Windows WinFsp** (dynamic `winfsp-*.dll`; the Windows packages carry the official installer and ask when the folder is turned on; declining leaves the switch; missing DLL → mount fails, vault stays open) |
| **Integration** | Desktop: `createDesktopServices()` → live root/settings/logs/vaults/FM/export; Mobile: `createServices()` → native if bridge linked, else mocks |

**What to build next (default order):**

1. macOS unlocked folder (v1.1)  
2. iOS (v3): document picker + the same core  

Vault list / create / open / close + groups are already live. **Do not** re-implement vault logic in TypeScript.  
**Do not** reimplement vault-root resolution in TS — use existing `vault_root_*` RPCs / `VaultRootService`.  
**Do not** put a time limit on work the person can stop — a job runs until it ends or Stop (`job_cancel`); everything else waits at most `OPERATION_LIMIT_MS` (`useOperationLimit`), then clears its state, bumps its generation token (`busyGen` / `resolveGen`), and offers Retry. Long work shows elapsed time (`ElapsedTime`), never an estimate or a countdown. See [`rules/operation-durations.md`](rules/operation-durations.md).  
**Do not** leave **Info** modals stale when changing settings, vault DTOs, root paths, or diagnostics mocks — extend `domain/system-info` / `domain/vault-info` in the same change. See [`rules/info-modals-sync.md`](rules/info-modals-sync.md).

**Logging notes** (app `.log` under `.upriv/logs/` — not vault plaintext; never dump vault trees into logs or OS temp for export):

- **Format / rotation / names:** canonical contract in [`dev/docs/sdd.md`](../dev/docs/sdd.md) §3.1 Logs; keep Rust `logging/format.rs` and `@upriv/shared` `domain/logs/format.ts` in sync.
- **`log_event` is lazy:** with no vault-root yet it does not write under `.upriv/logs/` (stderr/`eprintln` only).
- **Allowlisted UI `log_event`s** (no id/name/path fields): `vault_hidden`, `vault_group_hidden`, `ui_crash`, `import_cache_wipe_failed`.
- **Session clear:** NeedsSetup / incomplete / missing root clears the process logger so a stale writer cannot `mkdir` a fake `.upriv/logs`.
- **The device:** `app_start` and the first line in each data folder's log (`vault_root_ready`, or `vault_root_entered` after a switch) carry `device` (the device ID, or `unknown` with `run`) and `system`, so a data folder that moves between machines keeps a log that says which machine wrote what. No name of the computer or phone is read, logged, or stored. The ID is HMAC-SHA256 keyed by the OS machine ID (`upriv-core` `device.rs`); a phone's Kotlin side passes `ANDROID_ID` through `device_identity_set` when the module starts. Locks, plain-text and unfinished-file records, and each device's last backup in `persistence.json` name the device by that ID.
- **`ensure_logs_dir`:** never recreate a missing `.upriv`; only create the `logs` leaf after `validate_existing_vault_root`.
- **`vault_root_resolve`:** `found`, `needs_setup` (the first run: Default is selected, holds no `.upriv`, and this device has no row), or `selected_failed` (the selected choice, a row or Default, does not answer as a data folder: `choice`, `reason`); both name the vaults that ended with a lost data folder (`ended`). After `vault_root_ready` this process, any other call that finds no data folder is case B: it fails typed `vault_root_not_found` (**not** soft `needs_setup`), the selection stays, and the Gate's resolve after it answers `selected_failed`.
- **`log_list` / `log_get` / `log_delete`:** soft empty / soft no-op **only** true pre-ready bootstrap. After `vault_root_ready` this process, missing/corrupt root → typed A/B (`vault_root_not_found` / `vault_root_incomplete` / `data_folder_list_invalid`), **not** `Ok([])` (that would look like “no log files”).
- Contrast with **settings save:** soft `wrote: false` only before this process had a data folder (bootstrap); mid-session miss is `Err`. Same integrity spine.
- `VaultRootGate` may emit a second `vault_root_resolve` DEBUG line under React Strict Mode in development; production should see one probe per settings-ready / epoch bump.
- **Panics:** the request answers `internal_error`. The log names where it happened, from the source file's crate folder on (`at=upriv-core/src/…:<line>`, no folder of the machine): a job logs `job_ended outcome=failed reason=panic`, then the request logs `rpc_panicked method=<rpc>`. Every process-wide table and gate in `session/` (and the `state.json` lock) is taken as it is after a panic (`lock_table`), so a failed job never leaves a vault refused until Upriv restarts. An open session whose own lock a panic poisoned is not used again. The panic hook writes to stderr without panicking (`log_stderr`), because the app may be gone.
- **Zip writers:** every zip on disk writes through `SeekBufWriter` (`job_zip_file` for a job's zip, the stop beneath the buffer). Its buffer is wiped each time its bytes go out, and when it goes, since a plain-text export's readable files pass through it. Once one of its writes, flushes, or seeks fails, every later one fails too: zip 0.6.6 rewrites a finished entry's header in place, and a rewrite that failed after its seek makes the next finish (its drop) compute a size below zero, a panic in a debug build.
- **Export speed:** every file an export, a backup, or a backup export writes is a `PacedFile`: on Linux each 64 MiB window starts going to the disk without a wait once the window before it is written (`sync_file_range`), so the disk works while the next window is made and at most two windows wait in RAM; elsewhere each window is flushed. The install's flush of the whole file stays the point it is on disk. A plain-text `.zip` decrypts on a worker thread while it writes, as a `.7z` does, holding at most `DECRYPT_QUEUE_CHUNKS` chunks of plaintext in RAM. `export_cost_report` (ignored test) times each format on the machine. When an export is slow, the drive is the usual cause: a nearly full SSD without its own RAM writes about 40 MB/s once its fast cache is spent.

### Mid-session integrity (fail loud)

After Gate is **ready** / `settingsOnDisk`, I/O that assumes a valid contentor must not soft-succeed if that contentor is gone or corrupt.

| Case | Meaning | Wire | UI |
|------|---------|------|-----|
| **A** | `.upriv` corrupt / incomplete | `vault_root_incomplete` | Toast + bump `vaultRootEpoch` → Gate Repair |
| **B** | `.upriv` missing | `vault_root_not_found`; the selection stays | Toast (`modal.vault_root_setup.lost`) + bump epoch → the list with the search, as at launch (drop RAM locale/theme to defaults) |
| **C** | Root OK; `vaults/<id>` gone | `vault_not_found` | Toast + invalidate that vault session — **do not** reopen Gate |

**UI helper:** `reportVaultRootIntegrityFailure` in `AppSettingsContext` — bump `vaultRootEpoch`. If the data folder is **gone** (`vault_root_not_found`, or a phone's lost grant): reset in-memory prefs to defaults (English / default theme), toast `modal.vault_root_setup.lost`, and the Gate resolves again: the selection stays, so it shows the list while `data_folder_search` looks for a data folder that answers — do not keep the previous locale/theme to stamp a new root. A data folder found becomes the selection (its own prefs load, and a toast names both choices); none found leaves the list with the failing choice selected and each row's Retry. Core keeps the data folder in use (`data_folder_entered`); the resolve that finds it lost ends every vault still open there as after a crash (`leave_lost_data_folder`: nothing written, keys wiped, mounts released, plain-text folders and records kept), before a phone's root serves another tree. Its answer, the search's, and the Gate's apply carry their names (`ended`) until a data folder is in use again, so the window and the toast name them; the search waits for a close or an open still running there before it switches. An apply while a data folder is in use ends nothing. Incomplete leftover still Repair (keep RAM for that path). Callers: settings persist failure, **Logs** list, **Info** (system + vault), Settings `vault_root_resolve`, Groups save, list refresh. Each reports then closes its modal — never show stale `found` / `store/` paths for A/B.

**Settings save:** missing/corrupt target → `Err` (not `wrote: false`). Soft `wrote: false` only before this process had a data folder (bootstrap). Pre-root UI (`onDisk: false`) keeps prefs in memory without requiring a disk write.

**Case C:** `vault_not_found` when the root is valid but `vaults/<id>` is gone — toast + invalidate that vault; **do not** reopen Gate.

**Taxonomy is layered / extensible** — A/B/C are the presence spine, not a closed set:

| Layer | Examples | UI |
|-------|----------|-----|
| Vault-root | A, B, `data_folder_list_invalid`, `selected_failed`, marker I/O | Gate Setup / Repair / the list with its search; an unreadable list file stops at its own screen (Retry, Start a new list) |
| Vault | C, `vault_config_invalid`, store broken | That vault |
| Session/ops | `wrong_password`, already open, RAM, mount | Op toast |
| Transport | disk full, permission | `io_error` |

Rule: *I/O that assumed X valid → if X is gone/corrupt, typed Err of X’s layer — never silent `wrote: false` after ready.*

---

## Research snapshot: `temp/upriv/` (local, gitignored)

The repo may contain **`temp/upriv/`** on disk — a **frozen snapshot of an older Tauri-based tree** (pre–Electron migration). It is listed in `.gitignore` and is **not** part of the active build or CI.

| Aspect | `temp/upriv/` (snapshot) | `dev/` (active) |
|--------|------------------------|-----------------|
| Desktop shell | Tauri 2 (`src-tauri/`) | Electron + `upriv-daemon` |
| `upriv-core` | Large — vault, crypto, `seven_zip`, mount, session, … | Paths, config, `store/` crypto, vault list/create/open/close/fs/export/import/backup/delete, password and unlock-RAM change, Linux FUSE, Windows WinFsp |
| UI wiring | Often **real** Tauri commands | Live root/settings/list/create/open/close/FM/export/password/unlock RAM |
| Code quality | Grew fast; **inconsistent, shortcuts, debt** | Intentional boundaries, reviews, typed errors |

**How agents may use `temp/`:**

- **OK:** Read for **ideas**, flow order, edge cases, “how did we solve X before?”, test data shapes, 7z integration sketches.  
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
| 2 | [`dev/docs/sdd.md`](../dev/docs/sdd.md) | **How** to build — state machine, TOML layout, logs, `upriv-core` modules, 7z, FUSE, tests, build status |
| 3 | [`dev/docs/ARCHITECTURE.md`](../dev/docs/ARCHITECTURE.md) | **Stack** — React/Electron/RN, `upriv-core`, bridges, ADRs, platform matrix |
| 4 | [`dev/docs/VERSIONS.md`](../dev/docs/VERSIONS.md) | Pinned toolchains (Node, Rust, Electron, Expo) |
| 5 | [`dev/docs/LOCALE.md`](../dev/docs/LOCALE.md) | English for code/docs; UI via i18n keys only |

**Conflict resolution:** PRD + SDD define product behavior **except** rest layout, backups, and storage modes — [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md) wins there. `ARCHITECTURE.md` owns the stack choice.

---

## PRD ↔ SDD map (where to look)

| Topic | PRD | SDD |
|-------|-----|-----|
| Vision, storage modes, states | §1, §1.6–1.7 | §1, §2; rest layout in **`SECURITY-CRYPTO.md`** |
| v1 Linux + Windows scope | §1.1, §3.5 | §1.1 principle 0, §14 |
| Functional requirements (RF-*) | §3 | §2–§7, §8–§9 |
| Desktop UX (vault list, modals) | §3.7 | §8.2 |
| Android (SAF, APK, picked folders) | §3.6 | §9 |
| Vault folder layout, `config.toml` | §5 | §3 |
| Password / session security | §4 | §6 |
| Store crypto (Argon2id, AEAD, vs 7z) | RF-55 | §2.4.1, §6; **`.agent/SECURITY-CRYPTO.md`** |
| Non-functional (Rust core, UI boundary) | §6 (RNF-05) | §1.1, §4, §15 |
| Roadmap phases and build status | §9 | §14 |
| `upriv-core` modules, public API sketch | §11 (glossary) | §4 |
| 7-Zip integration | (flow in §1.9) | §5 |
| Recovery | (states §1.7) | §7 |
| ADR summary | — | §15 (+ `ARCHITECTURE.md` §7) |

---

## Product summary (storage / rest: SECURITY-CRYPTO wins over stale PRD/SDD)

- **At rest:** `store/` (Argon2id + XChaCha20-Poly1305). Lock = close. A backup is `<stamp>-<id>.zip` (`<stamp>-<id> <name>.zip` once named) in the vault's backup folder — a Stored zip with `README.md` and `config.toml` beside `store/` (`header/`, `index/`, `data/`, `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md`), no zip password (pins: `saves/<stamp>-<id>.zip` there). Close writes that zip when `[backup] enabled`. `skip_unchanged` defaults on: the zip is skipped when vault files match this device's last backup and that zip is still in the folder in use (or that folder cannot be reached to tell), and `.upriv-workspace.json` is not a change. Off writes a zip on every close. `README.md` records the UTC time that copy was written, the same instant as `<stamp>`, and the rounded size of the files in `store/` (not the exact length of the zip). That zip is the only backup form. Create-from-backup and a store `.zip` import pre-fill the wizard from that `config.toml` and write `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md` into the new `store/`. The new vault does not keep `README.md`. A `.7z` does not. Export and backup write that warning file before packing so the zip keeps it inside `store/`.
- **Backup folders:** each device keeps its own lists (see Folder lists below). The app's list (`[backups.devices.<id>]` in `settings.toml`) is rows, then Data folder (`.upriv/vaults/<id>/backups/`), the choice of a device with no group. A vault's list (`[backup.devices.<id>]` in its `config.toml`) is rows, then Use the app's (its default), then Data folder. A vault row writes to `<row>/upriv-<folder id>-backups/`, an app row to `<row>/upriv-backups/<folder id>/`, each with `saves/`; `<folder id>` is the vault id at the first backup there, kept in `persistence.json`, so a rename keeps finding them. Close and Back up now write to the folder in use; when that folder fails (missing, not answering, no permission, no room, a zip too large for it), the selection hands over for good to the next choice in its chain that works, saved at its level, with a toast and a `folder_switched` log line. Close now and Stop write no zip and switch nothing. Every zip gets a reference in `persistence.json` (`backup_folders`: `ref`, `device`, `system`, `dir`; `data` names the data folder), and a backup key names its folder by reference: `<ref>/<file>` or `<ref>/saves/<file>`. Writes and rotation happen only in the folder in use, and automatic deletion touches only the zips in `backups_written` (write order); zips anywhere else stay listed and untouched, and their references go once the zips are gone. `skip_unchanged` skips a zip only while the vault matches this device's last backup (`backup_devices`) and that zip's folder is the folder in use. The backup at the start of a password change (when **Back up first** is on) and the rebuild's copy go to `saves/` of the data folder, and to the folder in use only when the data folder has no room; with no room, or a zip that fails, the flow goes on without it and says why. Both stay as Saves until the person deletes them. The unlock-RAM change writes none. The Backups window marks a backup whose unlock RAM is below the vault's (`lowerUnlockRam`), never which password a backup has. The Backups window lists one collapsible section per folder that holds zips: the data folder, the folder in use, then the others, each with the name of the device that wrote there, with its Saves first and then its Standard backups under small headings. A folder no longer in use is dimmed with a line saying Upriv no longer writes or deletes there; one that cannot be reached shows its status with Retry and Forget (`backup_folder_forget`, the files stay). Each section has a select-all box for the whole folder, pins included, its count, and its folder with an open button. Naming a backup (`backup_rename`) puts the name in its file name, `<stamp>-<id> <name>.zip` (up to 80 characters; characters a system refuses become `_`; an empty name removes it), and pins it. A delete names every backup it will remove in one sentence above the confirmation. The actions on what is selected, and an export of several, sit in the window's footer, so choosing a row never moves the rows. Phones have the same lists, rows (picked folders), and sections. `backup_list`, `backup_delete`, `backup_promote`, `backup_rename`, and `backup_folder_forget` run on the folder lane, each folder checked with its own limit, so a drive that stops answering holds nothing else up. Delete vault leaves backups outside the data folder alone unless the person turns on its switch (off by default, shown only when `outsideBackups`); a folder that cannot be reached keeps its zips, and the toast says so.
- **Argon2id:** user picks cost at create; default **256 MiB / 3 passes**; also 32 MiB (less-secure), 64 MiB, 128 MiB, 1 GiB, and 2 GiB. UI explains **security + RAM to unlock**, not device class. Header params apply everywhere — never auto-downgrade.
- **Modes:** **`encrypted_dir`** (default — plaintext in RAM only: FUSE/WinFsp on desktop, **in-app file manager on mobile**) and **`upriv_plain`** (plaintext in its unlocked folder on disk while open; wipe on close; **Not recommended**; `plain_files` says what the folder holds: `chosen`, the default, starts empty and takes what the person sends from the file manager, `whole` writes every file on open. It is the **Only files I choose** switch on the plain-text option and is not a third mode. Deleting a sent file from the folder deletes it from the vault for good; **Remove from folder** takes it out and keeps it). These are the only two modes. Same `store/` on every OS.
- **Storage value:** the mode and `plain_files` together (`VaultStorage`, `store/storage.rs`), sealed in the index; an index without it reads as encrypted with Only files I choose, written only when it is not that default. `[storage]` in `config.toml` is its copy, for what runs before the password (the row's badge, "Where should the files go?", the attach, Info); a missing or unknown copy reads as the default too, so the vault stays listed. Plain text reaches the disk at an open only when both say `upriv_plain`, and every file only when both say `whole`. Both change only on the **Storage** screen (the row's Settings menu, after Unlock RAM): the two options, a note under Plain text naming the folder it would fill on this device, and the vault password. Its change is a job on a closed vault (`vault_change_storage`, `useStorageChangeJob`, the keys lane, row status `changing_storage`): a choice equal to the copy is refused first (`storage_unchanged`), then the unlock, then the index sealed with the choice and the copy written; no file is converted. `vault_config_save` keeps the `[storage]` on disk whatever it is sent. An open that finds the two differing never refuses: it is a reset, for good: the copy becomes the default with `[unlocked_folder] encrypted = "off"`, and once that is on disk the sealed value too; the session is marked (`storage_reset`), so no attach mounts a folder even when a write failed; the vault opens encrypted in the file manager; the answer carries `storageReset` (`saved`, or `unsaved` for the next unlock to write), with a toast and a `vault_storage_reset` log line. Every open looks for a leftover plain-text folder whatever the copy says. A store `.zip` import and create-from-backup keep the sealed value they carry and take `[storage]` from the carried `config.toml`, or the default (the wizard shows that mode locked); a `.7z`, plain-text `.zip`, or files import seals the wizard's choice. The rebuild of the tree seals the default and resets the copy (`storageReset` on its answer). The unlock window names the folder before the password (`vault_unlocked_destination`, the folder lane): a plain-text vault's always, an encrypted vault's mount point on desktop while its folder is on. Opening the unlocked folder takes no password.
- **States:** `open` = unlocked session (runtime). Where plaintext lives is the **mode**, not the word “open”. On disk: `closed` only.
- **Recovery:** dirty close (A) or leftover `upriv_plain` folder (D). A file whose data is missing or damaged (B) is marked on its index node and kept: the vault opens, only that file fails (`vault_file_unreadable`), the file manager marks it and its folders, a bar shows only those files, and the editor offers Delete and points to Backups. Nothing deletes it for the person, and no other work stops for it. Every regular file of `data/` no file names, whatever its length, is set aside in `vaults/<id>/held/` by the unlock that opens a session, recorded in the sealed index, and named when something else still names it (the blob's own recovery record, a backup zip); Upriv deletes none, and a blob the index released is deleted only by a session whose unlock marked no file missing for the first time. The file manager shows a line and a review window laid out like Backups, where the person puts back or deletes for good one item or every chosen one (select all) (`vault_fs_held*`, `useHeldReview`). Each blob starts with a 4096-byte key copy of the header block it was written under, so any blob plus the password opens that file, and carries recovery records after its chunks: sealed copies of its file's index entry under their own HKDF key, written at the seal that first names the blob (an import writes it in its worker) and at each close after it was written, read only by recovery. Both header files dead, gone, or older than the blobs (`vault_header_unreadable`), or both index files dead or gone under a header that opens (`vault_index_unreadable`): the row is `recovery`, and the unlock keeps the password and offers Rebuild from its own data (`vault_rebuild`, `useVaultRebuildJob`), a job that reads the header back from the key copies when it is lost, then writes a copy of `store/` in `saves/` of the data folder (or goes on without it, saying why), names each blob from the newer of its own record and the newest backup that names it, seals that tree, and moves no blob; create-from-backup is the way back only when no key copy opens (C). A pending password change settles first. The window closes, the row shows `recovering` with its elapsed time and Stop, and once it lands the vault opens with that password and a toast reports the files placed and those left for review in `held/`. Remove the folder (D) is a job (`vault_plain_remove`, `usePlainRemoveJob`): the window closes at once, the row shows `recovering` with its elapsed time and Stop, and the rest of the app stays usable. It has no time limit; a stop leaves what it did not reach, and the vault stays in recovery. Every plain-text folder Upriv writes has a record in `state.json` (device ID and system, path, the `.upriv-unlocked-id` of its `upriv-unlocked` folder, token). A record goes only when wiped, on proof (that `upriv-unlocked` answers with the record's ID and nothing of the session is there: the vault's folder is gone or holds no marker of it; a folder or marker that does not read proves nothing), or by Forget (`plain_record_forget`; the files stay as they are). While nothing proves where its folder is (the drive is away, or another drive took its letter), the vault does not open on that device (`plain_folder_unreachable`) and the row names the device and the folder, with Retry and Forget. A record follows its folder to this device when the folder answers here with the vault's marker. Delete vault is refused while another device's record of it remains (`vault_plain_elsewhere`).
- **`.zip` / `.7z`:** import/export outside `.upriv`. One import option. Every export holds its vault in a **package**: one folder named like the file, which carries the vault's name as it was typed, holding one folder named after the vault's id (`My notes-upriv/my-notes/…`, `vault/package.rs`). An import names the new vault after the name the settings it carries hold, or after that inner folder when it carries none (`vaultName` of `vault_import_probe`), so renaming the file never renames the vault. A chosen `.zip` is examined: `store/header/vault.header` at the zip root (a backup, named by its settings) or in the package's vault folder (an export) means a **zip of `store/`** (Recommended; copy ciphertext, settings kept from the `config.toml` beside `store/`). Anything else is ordinary documents wrapped into a new `store/` (new password and unlock RAM; one shared top folder is stripped, and the file's name names the vault). A `.7z` holds the package, with the vault's files directly in its vault folder. It does not carry the store-zip envelope. A **plain-text `.zip`** (the third option of the Export window, below `.7z`, **Insecure**: a red card, no encryption at all) holds the package the same way, and comes back through the same import option. Both may carry **`.upriv-config/`** in the package folder, beside the vault folder, which holds only the vault's own files: `config.toml` and `.upriv-workspace.json` (the file manager workspace, under its name in the vault), each behind its own export toggle (both start on), with a `README.md`. No folder is written when neither toggle is on, and importing works with any of it missing. In the create wizard each carried item has a switch (on by default): a `.zip` shows only what it carries, and settings fill the fields when it is picked. A `.7z` shows both switches, because its contents are unknown before the password: its settings are read by the password test, so while that switch is on the input fields a file can fill stay locked, with a notice, until the test passes. The steps and sections stay open, and the group fields stay usable. A new vault never keeps `.upriv-config/`; the name is reserved at any depth. Export is **per vault** (user chooses; store zip is default). Each option of the Export window has its own folder field (under the password on the `.7z` and plain-text options), chosen before Export like every other radio step; each format keeps its folder for the next export while the vault list is up. The password on those two options is the vault password, and the export itself checks it: Export runs it, and a wrong password, or the unlock limit, is marked on that field until it is edited. Enter in the password opens the `.7z` folder picker while that folder is missing, then runs Export. While an export runs both options are locked, the one being written shows its progress (`job_status`) in place of its fields, and the one footer button becomes Stop export (`job_cancel`). Once every byte is in, the flush and the rename finish and a stop is refused (`job_not_stoppable`). A stopped plain-text `.zip` answers at once and its `.upriv-part` is overwritten and removed on a thread of its own; a normal quit waits for that wipe, its window offers Close now once that takes longer than a moment, and Close now leaves what the wipe has not reached to the next launch (`hurry_partial_wipes`). Core writes `{display_name}-upriv.zip`, `{display_name}-plain-text.zip`, or `{display_name}-sevenzip.7z` into that folder and never replaces a file already using the name: it takes the next free number (`{display_name}-upriv-2.zip`, …, its package folder named the same), logs `vault_export_numbered`, and the UI toast names the file it saved (`vaultExportToast`). Every file goes into an export: a `.7z` or plain-text `.zip` keeps a file whose data is missing or damaged with zeros in those parts, so it is found where it was, and the toast names it too (`unreadable`). Export requires **that** vault closed (other vaults may stay open). File zip/7z import and create-from-backup copy a frozen tree — they do not require the source vault closed. No zip of a chosen set of vaults: **Export data folder** (the Export a copy choice in the Data folder modal) is the one whole copy, `<name>.zip` holding `<name>/<folder>/.upriv/`: the typed name names the zip and its outer folder, and the data folder inside keeps its own name (`Upriv` on a phone), ready to choose as a data folder once unzipped. An Include backups switch, on by default, leaves each vault's `backups/` out when off; backups in a backup row's folder are outside `.upriv`, so no copy holds them, and the window counts the vaults that keep some there (`outsideBackups`, from the backup references). The name field starts as `upriv-<UTC stamp>` and resets after each export; core checks the same portable rules as `dataFolderZipNameIssue` (shared `zip-name-cases.json`) and refuses a name already in the folder (`data_folder_export_name_taken`). Every vault must be closed or in recovery, and core holds them all until the zip is written (see SECURITY-CRYPTO).
- **Backup export:** `backup_export` copies one backup zip, or bundles several into one Stored zip (`upriv-backups-<id>.zip`), into a folder the person chooses in the Backups window. No name step: a folder from the picker starts it; a kept or typed folder waits for Export. It is a job like a vault export: progress from `job_status`, Stop export through `job_cancel`, no file left by a stop or a failure, the next free number when the name is taken, and a toast naming the file. One backup grows its own row with the bar; several show it in the window's footer, above the selection bar. The vault list owns the job (`useBackupExportJob`) and the folder, so the export outlives the window and the folder stays for the next one. The vault may be open, because a backup is a frozen file; only delete and rename of that vault wait until the export ends, and the backups it reads cannot be deleted, pinned, or rotated away (`backup_exporting`).
- **Compression UI:** presets none/low/medium/high apply to **export** `.7z` (`[seven_zip]`).
- **Close:** write `store/` from the session (stream / mount buffers), drop the keys and release the mount, then write the backup zip, so a slow drive waits with no key in RAM. Export `.7z` is a separate action — stream logical content; never pack `.enc` blobs. Unsaved drafts or a running import ask from the vault list (`VaultClosePrompt`), for one vault or Close all, and the file manager stays where it is until the close starts, then goes with it.
- **Close now:** the same close with no backup, for a vault that must go right away. It is in More options below Note while the vault is open, on desktop and mobile. It seals the index, drops the keys, and releases the mount. An `upriv_plain` folder gets no closing pass and no overwrite, so changes other apps made that the vault has not saved are lost, and the files' bytes stay on the disk until it reuses the space. It asks first while `lifecycle_confirm_close_now` is on (the window's Don't ask again turns it off; System settings turns it back on). The quit window's Close now asks in that same window, with the same switch. An unsaved editor tab always asks and is discarded on confirm; a running import refuses it with a toast. It waits in the open/close queue like any close. The next normal close writes the skipped backup. The quit dialog's Close now runs it on every open vault (`app_shutdown` with `now`, Linux, Windows, and macOS alike). After `SHUTDOWN_NOW_TIMEOUT_MS` (30 s) Electron stops the daemon, and the next launch recovers what was left. A normal quit asks while a job runs or waits and then waits for it with no deadline; an OS shutdown or log-off is Close now. `app_shutdown` also waits for a close already running, and with `now` tells it to hurry.
- **Close now on a running close:** More options keeps Close now in its place below Note while a close runs or waits, with the same confirmation, and it opens for a waiting close too. It sends `vault_close_hurry`, a light call that runs beside the close and sets that close's hurry flag; Close now itself is a close that starts with the flag set. The closing pass, the backup zip, and the overwrite stop where they are, and the partial zip is removed. Sealing the index always finishes. Zips go to the disk one 64 MiB window at a time (`PacedFile`) and overwrites flush every 64 MiB, so a stop never sits behind one long flush. A close still waiting in the queue runs as Close now when its turn comes, without jumping the queue. A hurried close of a folder the marker proves is this session's removes the files before the seal, so the seal does not wait for data the disk has not written yet; the store keeps every saved file, and if the seal fails the session goes back and the next pass fills the folder again. The row skips the 2 s Closing floor after Close now.
- **Passwords:** RAM only in v1 default; never in `localStorage`, UI config, or logs. A new vault password that is objectively poor gets one line under the field (`@upriv/shared` `domain/password-weakness`, SDD §3.2.3b): Upriv's own check in the UI, with no third-party data, that keeps nothing, never blocks a password, and never rates one.
- **Password change:** a job on a closed vault (`vault_change_password`, `usePasswordChangeJob`, the keys lane): a new key, and every file rewritten with it batch by batch, so after it and its key copies pass nothing in the vault opens with the old password and the vault holds one key. Its window has **Back up first** (on each time it opens; a Save written when there is room, never required), the step, bar, elapsed time, and Stop; a stop leaves the old password, with a fresh write key the new password never held. After a crash the new password settles a pending change forward (the row is `recovery` and the unlock asks for it, `password_change_interrupted`), and an unfinished one shows **Finish** in Password settings (`vault_password_change_finish`). The **unlock-RAM change** (`vault_change_kdf`, `useUnlockRamChangeJob`) keeps the keys and updates every blob's key copy; it writes no backup. Each opens with the job after an open (`vault_key_copies_update`, `useKeyCopiesAfterOpen`) finishing key copies a stop or a crash left behind. An earlier password of the vault answers `password_outdated`.
- **Delete vault:** a job (`vault_delete`, `useVaultDeleteJob`, the delete lane) in a window of its own, opened from the last entry of the row's Settings menu (shown only while the vault is closed or in recovery), never a screen of vault settings and no danger zone. `[deleting]` in `config.toml` comes first and the file goes last, so a crash leaves the row `deleting` with **Continue** as its main button; each blob's key copy is overwritten before it goes. **Delete now** in More options (`vault_delete_hurry`) ends it with no overwrite, after a confirmation. Group settings has a Delete group… entry that opens its own Delete group window.
- **Surface anti-brute-force:** in-process; **5** failed `open`s in **60 s** → **60 s** block (resets when Upriv quits). See `SECURITY-CRYPTO.md`.

---

## Repository layout

```text
upriv/
├── .agent/                 # This file — AI project context
├── docs/gitflow/           # GitFlow spec — see also CONTRIBUTING.md / SECURITY.md at repo root
├── temp/                   # Optional local snapshot (gitignored) — see § Research snapshot
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

**Desktop UI:** Electron (`createDesktopServices`) talks to `upriv-daemon` for vault-root, settings, logs, vault list/create/open/close/`vault_rename`, groups, `vault_config_save`, in-app file manager (`vault_fs_*`), export/import, backups, Export data folder (`data_folder_export`), and the job calls that watch or stop a long export or save (`job_status` / `job_cancel`). There is no desktop in-memory vault list. Linux FUSE and Windows WinFsp are live in core. After each encrypted open the UI calls `vault_unlocked_folder_attach` (a job, outside the open/close queue); core alone decides whether a folder is wanted, and its answer is the toast. "Open unlocked folder" (the vault row's More options), "Show in unlocked folder", and "Open in terminal" show only while `vault_fs_os_path` answers `ready` (`useOsFolderReady`: asked again each second while the attach runs, and each time More options opens). A vault with no folder (its switch off, none chosen, an encrypted vault on a phone) offers none of them, and says nothing. Password and unlock-RAM change go through `vault_change_password` / `vault_password_change_finish` / `vault_change_kdf`, the Storage change through `vault_change_storage`, the unlock window's folder line and the Storage screen's note through `vault_unlocked_destination`, the delete through `vault_delete` / `vault_delete_hurry`, the key copies after an open through `vault_key_copies_update`, and Info reads `vault_key_status`. Notable conventions:

- **Pipeline:** `useVaultPipelineRun` enforces SDD §8.2.2 — one open/close at a time (`isRunning`).
- **Auto-close:** `useIdleAutoClose` (`@upriv/shared/react`) closes each opted-in vault from the device clock; one notice per vault entering its warning window; an import or busy pipeline retries after 5 s. See SDD §3.2.5.
- **Settings ↔ list:** vault settings save goes through `vault_config_save`; the list patch carries the `[vault]` fields. The row's mode moves only with a Storage change, an open's reset, or a list refresh (`applyVaultStorageMode`).
- **Feature module boundaries:** each `features/vaults/*` and `features/system/*` folder has one `index.ts` — see [`dev/apps/desktop/README.md`](../dev/apps/desktop/README.md).

Electron already uses `desktopInvoke()` → `upriv-daemon` → `upriv-core` for list/create/open/close. Do not treat the renderer password `Map` as the unlock store — session keys live in `upriv-core`.

### Data flow

```text
Desktop:  React ──desktopInvoke──► upriv-daemon ──► upriv_rpc ──► upriv_core::*
Mobile:   RN ──UprivCore──► libupriv_ffi.so ──► upriv_ffi::invoke ──► upriv_rpc ──► upriv_core::*
```

### Rust workspace

- Build from `dev/`: `cargo build -p upriv-daemon -p upriv-fuse`, `cargo test -p upriv-core`, `npm run rust:lint` (rustfmt + clippy).
- `./r l` also runs clippy for `x86_64-pc-windows-gnu`, `aarch64-linux-android`, and `aarch64-apple-darwin` (skipped locally when rustup lacks the target; CI installs all three). Code behind a platform `cfg` must pass there too.
- Vault crypto crates live in **`dev/vendor/`** (`[patch]`). Refresh is the checklist in `dev/vendor/MANIFEST.txt`; do not `cargo generate-lockfile`. See [`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md) agent rule 2.
- Artifacts go to **`dev/target/`** only — **never commit** `target/`, `node_modules/`, `dist/`, `.expo/`.
- `upriv-daemon/src/main.rs` is entry only; do not add vault logic there — use `upriv-core`.

### `upriv-core` modules

Rest layout and crypto bar: [`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md).

```text
upriv-core/src/
├── lib.rs
├── config/          # app settings.toml + vaults/*/config.toml + vault groups; list saves
├── device.rs        # this device's ID and system (no lists, no names)
├── folder_list/     # per-device folder lists: model, path rules, chains (pure),
│                    #   the data folder list file, unlocked folder and backup layouts
├── folder_probe.rs  # time-limited folder checks, one thread per stuck folder
├── vault/           # list / create / open / close / rename / fs / export / import / backup / delete / rebuild
│   ├── password_change.rs, unlock_ram_change.rs, header_commit.rs # the two changes and their four-write commit
│   ├── key_pass.rs  # the key copies pass after an open, and Info's key status
│   ├── plain/       # upriv_plain folder open/close + wipe, plain-text records
│   ├── unlocked_folder.rs # an encrypted vault's attach after the open
│   ├── data_folder.rs     # data_folder_apply / data_folder_search
│   ├── folder_status.rs   # folder_status of one row
│   ├── seven_zip*   # in-RAM .7z pack/unpack (export/import only — not rest)
│   ├── plain_zip.rs # plain-text .zip export, and the wipe of what a crash left
│   └── config_folder.rs # .upriv-config/ of a .7z or plain-text .zip
├── session/         # open session keyring in RAM, unlock throttle, jobs and their steps
├── paths/           # VaultRoot, launch resolution of the data folder, reserved paths
├── mount/           # FUSE host (Linux), WinFsp (Windows)
├── store/           # At-rest ciphertext (keyring header + index + blobs with key copies; the unlock rule; the pass)
├── logging/         # session log writer under .upriv/logs/
├── runtime_state.rs # .upriv/state.json open records (dirty-close recovery)
└── host_fs.rs       # filesystem access, incl. Android storage-access trees
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
| `.upriv/state.json` | Open sessions (volatile), plus the plaintext records a crash must not lose |
| `.upriv/vaults/<id>/config.toml` | Vault config (list/name; no password); `[deleting]` while a delete is in progress, the file removed last |
| `.upriv/vaults/<id>/persistence.json` | Persisted `closed` only (+ sync metadata, and `content_hash` of both header files and the primary index) |
| `.upriv/vaults/<id>/store/` | Vault body at rest (`header/vault.header` + `header/vault.header.copy`, the keyring + `index/root.idx.enc` + `index/root.idx.enc.copy` + `data/`, each blob a 4096-byte key copy, its chunks, then its recovery records) |
| `.upriv/vaults/<id>/held/` | Ciphertext no file of the tree names, set aside by an unlock and recorded in the index. Not in backups or store zips |
| `.upriv/vaults/<id>/backups/<stamp>-<id>.zip` | Frozen Stored zip of `store/` (pins and named backups under `backups/saves/`). The Data folder choice of every backup list |
| `<row>/upriv-<folder id>-backups/`, `<row>/upriv-backups/<folder id>/` | The same zips and `saves/` in a backup row's folder (a vault's row, the app's row) |
| `<row>/upriv-unlocked/{display_name}/`, `<data folder>/upriv-unlocked/{display_name}/` | A vault's unlocked folder while open (a row, or Beside the data folder): real files for `upriv_plain`, a FUSE/WinFsp mount for `encrypted_dir`. `upriv-unlocked/.upriv-unlocked-id` holds that folder's ID. Not created at vault-root init |
| `<app home>/.upriv-data-folder` | The data folder list, every device's group. Not part of any data folder |

Portable `.zip` of `store/` and `.7z` are **export/import files**, not modules under `vaults/<id>/`.

### Folder lists

The data folder, the unlocked folders, and the backup folders each keep a saved list of folders, one **device group** per device (core `folder_list/`, shared `domain/folder-lists/`). A device is one machine or phone, keyed by its device ID; there is no central store of devices. A group holds `system`, `selected`, `next_number`, and `rows` (`number`, `name` up to 80 characters, `path`). The screen names a device by its system and the first 5 characters of its ID, "Linux · 3f2a1" (shared `deviceName`): built each time, never stored, the same in every window, and nothing to rename. Only what differs from the defaults is stored, and a group exists only while it holds something.

| List | Where | Choices, in priority order | A device with no group |
|------|-------|----------------------------|------------------------|
| Data folder | `.upriv-data-folder` in the app home, `[devices.<id>]` | rows, Default | Default |
| Unlocked folders, app | `settings.toml` `[unlocked_folders.devices.<id>]` | rows, Beside the data folder | nothing selected |
| Unlocked folder, vault | `config.toml` `[unlocked_folder.devices.<id>]` | rows, Use the app's | Use the app's |
| Backups, app | `settings.toml` `[backups.devices.<id>]` | rows, Data folder | Data folder |
| Backups, vault | `config.toml` `[backup.devices.<id>]` | rows, Use the app's, Data folder | Use the app's |

- **Order is priority.** The rows are tried top to bottom, then the fixed choices. On screen the fixed choices sit on top and never move, the rows below them, and Add folder on the right at the bottom, so a new row opens right above it. On the current device one choice is selected, with a radio; a row added or copied there is selected. A row's actions sit in one ⋯ menu at its end (Edit for its name and folder, Open folder, Move up and down, Delete; Copy on another device's rows), outside the radio, and never select it; its editor and a delete's question open under it. While no other device has a group in a list, it reads as a plain list; once one does, this device's group shows under This device with its name, and the other devices below it by name, collapsed, with Copy and text edits but no radio. Nothing copies into a phone, and a phone's row copies nowhere: a phone row is a storage-access grant, picked there.
- **Paths** are checked against their group's system with string rules (`path_rules.rs`, contract `folder-path-cases.json`): absolute on Linux and macOS, a drive or UNC path on Windows, a `content://` tree on a phone. The same path ignores case on Windows and macOS (`folder_path_duplicate`); nothing inside a `.upriv` (`folder_path_reserved`); a backup row never inside an `upriv-unlocked`, an unlocked folder row never inside an Upriv backups folder (`folder_overlap`).
- **Failover.** A selection that fails hands over for good to the first choice in its chain that works, saved at its level, with a toast and a `folder_switched` log line. Only the folder failing counts: missing, not answering, no permission, no room, a file too large for it, a file system that cannot hold it, a path the rules refuse. A vault read error, a missing driver, or a stop switches nothing. Nothing selected is its own state and never hands over, and failover never lands on Beside the data folder.
- **Saves** send what changed per group (`ListChanges`: rows with `next_number`, selection, removal); until then a new or edited row carries Not saved beside its name (`rowUnsaved`; not in the create wizard, where nothing is saved yet), and core applies them under the file's lock after reading the file again. Each row's status comes from `folder_status` on the folder lane, within `FOLDER_STATUS_CHECK_LIMIT` (5 s); a check that decides a switch waits up to `FOLDER_SWITCH_CHECK_LIMIT` (30 s).
- **Deleting** a row or a device group removes references only. An unlocked folder row is refused only while a vault is open there (`folder_in_use`), and a change of its path too: the row's status names the open vaults (`openVaults`), and while it does the row's delete and path stay locked, with why (`rowInUse`). Upriv then removes its `upriv-unlocked` when that holds nothing but its ID file, never the row folder.
- **An unknown device** (no OS machine ID and no `device-id` fallback file) uses the defaults that run, its lists cannot change, and a plain-text vault does not open (`device_unknown`).

### Unlocked folders

The folder of the OS where an open vault's files appear: `{row}/upriv-unlocked/{vault name}`, or `{data folder}/upriv-unlocked/{vault name}` for Beside the data folder; a row that already ends in `upriv-unlocked` is used as it is. Upriv writes `.upriv-unlocked-id` (32 hex characters) the first time it uses an `upriv-unlocked` and never rewrites an ID there (a file that holds none is replaced), and removes the folder with its ID file when its last vault folder goes; when the folder cannot go, its ID stays. "Workspace" names only the in-app file manager's working area (`.upriv-workspace.json`), never this folder.

| Store | Fields | Role |
|-------|--------|------|
| `.upriv/settings.toml` | `[unlocked_folders]` `encrypted_vaults` | Every device: encrypted vaults get an unlocked folder. Starts off. |
| `vaults/<id>/config.toml` | `[unlocked_folder]` `encrypted` | Every device, whichever choice is in use: `inherit`, `on`, or `off`. Starts `inherit`. A failover never turns it on or off. |

- **Plain text** writes its files there while open (as `plain_files` says). With nothing selected (the vault's group uses the app's, and the app's has nothing), "Where should the files go?" asks before the password: Beside the data folder, a folder added to the app's list, or one added to this vault's own list; a typed or picked folder is checked as it changes, as a list row is (`plainPlaceProblem`, then `folder_status` on desktop once the path settles), and Continue waits until it passes; a removable, network, or cloud folder is warned about (`PlainFolderClass`). `vault_unlocked_destination` (`mode` `upriv_plain`) reports the folder an unlock would fill after walking the chain, saving nothing, and the unlock window names it; when no choice of the chain answers, the unlock stops before the window (`unlocked_folder_unavailable`). The unlock walks again and saves the switch when it fills that folder.
- **Encrypted** vaults open in the in-app file manager at once. The desktop then calls `vault_unlocked_folder_attach` (a job: `newJobId()`, no time limit, folder lane), which walks the chain, mounts, saves a switch, and answers `mounted`, `switched`, `off` (also for a session an open reset), `driver_missing` (Windows offers the WinFsp installer, Linux `fuse3`, then attaches again), `unset`, `unavailable`, or `failed`; `vault_fs_os_path` answers `attaching` meanwhile. A close stops it, none starts once a close began, and a quit stops it at once. On Windows the folder is a directory junction; exFAT and FAT cannot hold one (`unsupported`), a folder failure that hands over. Ciphertext can stay where it is. A drive-letter mount is not used. Phones mount no encrypted vault's folder: the switches show there, unavailable.
- **Sessions keep their folders:** a list change applies from the vault's next open or close. The one exception is the app's switch turning on: the desktop then attaches every open encrypted vault at once (`useAttachWhenFoldersTurnOn`). Turned off, a mounted folder stays until its vault closes.
- **A folder wanted and none chosen:** when a vault should get an unlocked folder on this device and neither its list nor the app's chooses one (`encryptedFolderUnchosen`), the list says so with every choice (or the selected Use the app's) wearing attention. Save waits only when the window's own draft creates that state, so a switch another device turned on never holds an unrelated save; the create wizard reports it as `unlocked_folder_unchosen`. The driver notice (`UnlockedFolderDriverNotice`) shows only while a folder is wanted.

Do not create an unlocked folder at vault-root init. Paths under `.upriv/` are reserved.

For local testing against a real tree, use a fresh vault-root or set `UPRIV_VAULT_ROOT` knowingly.

**Naming:** `vault_id` normalized; `display_name` keeps user spelling; export file name = display name (characters a system refuses become `_`, `vault_folder_name` / `vaultFolderName`) plus what the file holds (`-upriv`, `-plain-text`, `-sevenzip`; `export_stem` / `vaultExportFilename`), with `-2`, `-3`, … added while that name is taken in the folder. The package folder inside takes the file's name; the vault folder inside it is the vault's id.

### Data folder at launch

Order in `upriv-core` `paths::resolve_vault_root`:

1. Explicit path (`UPRIV_VAULT_ROOT` / caller) wins over the list; nothing is written for it, and the Data folder window says the environment sets it.
2. This device's selection in `.upriv-data-folder` (no group: Default):
   - **Default** holding a `.upriv` opens. Default with none and no row on this device is the first run: `needs_setup`, Setup with Default preselected, and Continue makes one there. With rows to try, it is `selected_failed`.
   - **A row** that answers as a data folder opens. One that does not is `selected_failed`.
   - On `selected_failed` the Gate shows the list at once while `data_folder_search` (a job, folder lane) checks the selection, this device's rows, then Default, each within its own limit, and the first in the chain that holds a valid data folder becomes the selection, with a toast. The person can pick meanwhile; the pick stops the search. The search never makes a data folder and never takes an incomplete one; an incomplete selected folder goes to Repair. The list always has a choice: nothing selected is not a state of the data folder list. A data folder lost while Upriv runs (case B) lands here the same way.
3. A list file that cannot be read stops at its own screen (`data_folder_list_invalid`: Retry, or Start a new list, which replaces the file).

`data_folder_list` reads the list (every device's group, and where Default is). `data_folder_apply` saves the list's change and opens the folder it selects, making a data folder only where the person chose (inside a row's folder that exists, or at Default) or replacing an incomplete one by the chosen policy; it needs every vault idle (`vault_root_busy`). On a phone, `adoptPrivateRoot` makes it the job that copies the private data folder into the granted one.

**Default:**

| Launch | Distribution | App home (`.upriv-data-folder`) | Default |
|--------|--------------|--------------------------|----------------------------------------|
| `npm run electron:dev` | `dev` | `dev/` via `UPRIV_DEFAULT_ROOT_ANCHOR` | Same as app home |
| Packaged AppImage / portable exe | `portable` | Beside the downloaded file (`UPRIV_PORTABLE_FILE`), else `$APPIMAGE` / the exe | Same as app home |
| Packaged system install (`.deb`, NSIS, macOS DMG, …) | `installed` | User data (`~/.local/share/upriv`, …) | Same as app home |

**Portable packaging exists only on Linux (AppImage) and Windows (portable exe)** — one file that runs with no install and keeps the data folder beside it; this is a product requirement (PRD §3.5.1), not a dev convenience. macOS is always `installed` (Application Support). Android has no portable mode — a storage-access data folder only. See `dev/README.md` packaging matrix.

Electron sets `UPRIV_DISTRIBUTION` + `UPRIV_DEFAULT_ROOT_ANCHOR`. Default is beside the app when portable and the user data dir when installed, including a writable Windows install directory; a device Upriv has not seen uses it, so a portable copy opens the data folder beside it on any machine. Android's Default is **Documents/Upriv**. Rust `suggested_vault_root()` (`~/Documents/Upriv`) is exposed as `vault_root_suggested_custom_path`, where Add folder's picker starts on desktop. Packaged **macOS is always `installed`**. **Portable remains the product default** when only an anchor is set (USB/HD-first), unless the anchor already matches the OS user-data home.
### Selecting an existing `.upriv`

When the list selects an already-valid data folder, **do not change** that folder’s `.upriv/settings.toml` — only save this device's list and reload UI prefs from disk.

Pre-root UI prefs are carried by the **bootstrap prefs bag** — a named payload distinct from the data folder: `VaultRootBootstrapPrefs` in Rust (`upriv-core`) and TS (`@upriv/shared`), nested under `bootstrap` on the `data_folder_apply` wire (never a top-level peer of `changes` / `replaceIncomplete`); every apply carries its locale. Today the only pre-root pref is UI locale (Gate selector); future entries (theme, high-contrast, etc.) extend the same bag without renaming setup APIs. Bootstrap prefs seed the new `settings.toml` **only when creating** a new `.upriv` (or incomplete→replace) — the daemon ignores them on a Valid target so opening never rewrites another vault-root's UI prefs. **System settings** Save edits the **active** root only; switch/create data folder via the vault-list **⋯ → Data folder** modal (not inside System settings).

**Data folder switch:** UI blocks apply while any vault is not `closed` / `recovery` (also `opening` / `closing` / `creating`). Modal stays open read-only — no bulk-close. Core refuses `data_folder_apply` with `vault_root_busy` while a session is open, mid-close flush, Argon2 unlock/create holds the process gate, or the data folder is being exported. Deleting the row in use asks first; the selection then moves to the first row left, or Default when none is, and Apply switches to it.

**Export data folder** is a further radio in the same Data folder modal ("Export a copy"), under its own heading below the list, whose choice in use carries an **In use** badge. The one footer button follows the choice: Apply, Export, or Stop export while it runs. Choosing Export a copy drops the list's draft and shows no choice of the list chosen, so the copy is always of the data folder in use; choosing a folder again goes back. Choosing it opens nothing: it wears the attention border until it has a folder and a usable name (`dataFolderExportPending`), and Export waits. On desktop the folder is typed or picked; on a phone it is picked (a storage-access grant). Enter in the name opens the folder picker while the folder is missing, then runs Export. The folder stays for the next export while the vault list is up, also after the window closes; the name starts over after each one. All radios follow [`rules/radio-choices.md`](rules/radio-choices.md). While an export runs the list is locked and Export a copy stays chosen. Setup has no Export a copy. Its name and folder fields always show, inactive until it is chosen. Desktop and mobile share the export job (`useDataFolderExportJob`). The window says the zip was saved (by name, not path) only while it stays open: opening or closing it drops that line (`clearWritten`); the toast covers an export that ends while it is closed.

**Config edit policy:** `@upriv/shared` `domain/edit-policy` (contract `edit-policy.json`) is the table for what may change while a vault is busy (`anytime` / `vault_quiet` / `vault_closed` / `vault_closed_or_recovery` / `root_idle` / `no_open_session`). Hybrid default: list/next-close prefs anytime; the vault's unlocked folder group on this device needs **quiet** (no open/opening/closing; recovery OK; **creating and queued-open are still quiet** at this gate); other devices' groups and both backup lists are `anytime`; the app's unlocked folder group on this device needs `no_open_session`, and the data folder list `root_idle`; `vault.display_name` / `vault.id` need **closed or recovery** (not creating/queued — those wait on create Argon2 or a queued open). The storage value is no config target: only the Storage screen changes it. Change-password, Finish (`action.finish_password_change`), KDF, and Storage (`action.change_storage`) need **strictly closed** (not recovery); delete (`action.delete`) needs closed or recovery. App targets stay coarse (`ui` / `logging` / …) until fine field locks are needed. A password change rewrites every file onto a new key; an unlock-RAM change keeps the keys and updates the key copies. See SECURITY-CRYPTO. **Rust** `save_vault_config_checked` / RPC `vault_config_save` refuse quiet-gated changes (this device's unlocked folder group) while the session is open, mid-close, or Argon2 is in flight (`vault_config_busy`) — same targets as `rustConfigSaveQuietTargets` in the JSON contract — and store the `[storage]` already on disk whatever they are sent (UI may also refuse edits while list status is **opening** — that is pipeline UX, not the quiet predicate). Display name and folder id change **only** via RPC `vault_rename` (never `vault_config_save`; a live save of those fields is `VaultConfigInvalid`). `rename_vault` also refuses while this vault is open, mid-close, or preparing (open/create seed). Quiet gate allows creating and a queued open on a closed vault. A queued close on an open session is not quiet. Waiting close shows `queued` until it starts; waiting create stays `creating`. Row UI usually hides settings while pipeline-busy. Locked-field copy comes from `lockedI18n` in that contract (`vaultConfigEditLockedI18nKey`). A leftover plaintext folder (`plainLeftover` on the list row, from `holds_leftover`) also locks the vault's unlocked folder group on the device that holds the record, its name, and id (`plainLeftoverLocked`), with copy saying to remove the folder first. Core keeps refusing those with `plain_leftover`, and refuses the Storage change too, as every closed-vault change, so a vault cannot turn encrypted while its old plaintext is still on disk. A recovery with no leftover stays editable.

---

## Scope

Vault list / create / open / close / `vault_rename` + groups + `vault_config_save` + in-app file manager + Linux FUSE + Windows WinFsp + zip/7z export/import + backups + password and unlock-RAM change + the Storage change + delete run on Electron and native FFI (Android: storage-access data folder). Packaging: AppImage and `.deb` on Linux, NSIS and portable `.exe` with the WinFsp installer on Windows. Remaining platforms: macOS mount, iOS. **Do not** re-implement list/create/open/close/rename, the password or unlock-RAM change, or delete in TypeScript. Any new encrypted I/O keeps the RF-45/RF-49 tests — see [`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md).

**Import:** desktop native picker + `vault_import_probe`. An OS drop pre-fills the create wizard when the shell provides a path.

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
./r d                                       # wipe Vite cache, then electron:dev
./r m                                       # wipe Metro/Expo cache, then expo start --clear
./r m -a                                    # same, open Android
cargo test -p upriv-core
npm run rust:lint                          # rustfmt --check + clippy
npm run rust:fix                           # rustfmt + clippy --fix
./r l                                       # all linters (TS + Rust)
./r f                                       # auto-fix where supported
./r t                                       # cargo test --workspace + shared/desktop vitest
./r c                                       # lint + test
cargo build -p upriv-daemon -p upriv-fuse --release

# Mobile
npm install --prefix apps/mobile
./r m                                       # from dev/; or npm run start --prefix apps/mobile
npm run typecheck --prefix apps/mobile
```

---

## Coding guardrails

1. **Language:** English for docs, code comments, logs, TOML comments, commit messages. UI text = **i18n keys** in `dev/apps/shared/locales/*.json` only (`LOCALE.md`).
2. **Minimize scope:** Smallest correct change; match existing style; no drive-by refactors.
3. **Security:** No passwords/secrets in logs, commits, or UI persistence. Use `zeroize` in Rust for sensitive buffers.
4. **Config:** TOML is source of truth, except the storage value, which the sealed index holds (`[storage]` is its copy); mutable at runtime; re-read before open/close.
5. **Fail safe:** No overwrite of `store/` without verification and atomic write.
6. **Git:** Read [`GIT.md`](GIT.md) before commit/PR. Never commit `dev/target/`, `node_modules/`, `dist/`, `.env`, large binaries. Commit `Cargo.lock` in workspace. **Never** set the AI as Git author or co-author — use Git’s effective `user.name` / `user.email` (local if set, else global). After each commit, verify identity and that the message has no AI credit. After every PR create or edit, read the body and delete any AI tool footer (`Made with Cursor`, `Generated with [Claude Code](…)`, …) if the host appended one.
7. **Design:** Shipped UI follows PRD §3.7 + SDD §8.2 + i18n.

---

## Platform phases (PRD §3.5)

| Phase | Platform | UI | Core delivery |
|-------|----------|-----|----------------|
| **v1** | Linux + Windows desktop | Electron + React | `upriv-core` + FUSE (Linux) / WinFsp (Windows) |
| v1.1 | macOS | Electron + React | Platform mount |
| v2 | Android | React Native | `libupriv_ffi.so` + SAF |
| v3 | iOS | React Native | Same core, document picker |

Vault **format** is cross-platform from day one; **v1 desktop app** ships on **Linux and Windows**.

---

## Mobile packaging

One **APK** = JS bundle + RN runtime + **`libupriv_ffi.so`** (UniFFI; `.7z` via `sevenz-rust2` inside) + the `modules/upriv-core` Expo module. Mobile uses React Native, not Electron. Expo Go does **not** load custom Rust; it runs on mocks.

### Android data folder

The Android default data folder is **Documents/Upriv**. `.upriv/` is not created in the private app folder. App-specific storage (`filesDir`, and `Android/data/<package>/`) needs no confirmation and is deleted on uninstall, including a directory created there under a Documents name. Shared Documents stays after uninstall, and Android requires one system confirmation before the app can create it. The system screen opens on Documents, which already exists, so confirming it is the step. Upriv creates the `Upriv` folder inside that grant, and the vault lives there. The persisted grant is Documents: Android will not grant a folder that does not exist yet, and it will not narrow a parent grant. Default is that grant's `Upriv` child (or the tree itself when the grant is already `Documents/Upriv`); Kotlin finds it among the persisted grants. The private app folder (`filesDir/upriv`) is the app home: it keeps the data folder list (`.upriv-data-folder`), not the vault tree, and disappears with the app. The ciphertext stays. On the next install the user confirms the same folder; an existing `.upriv` is opened as-is. If the app folder already has `.upriv` and the granted folder does not, `data_folder_apply` with `adoptPrivateRoot` copies the tree (a job) and removes the app-folder copy only after the copy matches. If the granted folder already has `.upriv`, both stay. A `.upriv` found only in the private app folder is not opened as the data folder; setup asks for Documents/Upriv and then copies it. Do not copy a vault into `filesDir` or OS temp to fake a mount.

- Do **not** request `MANAGE_EXTERNAL_STORAGE`. Do not treat `/storage` or `/sdcard` as a path Rust can open.
- **Trees.** Every phone row is a storage-access tree picked with a persistable grant. Rust reaches the data folder in use at `/upriv-saf-root` (the selected row's tree, or Default's grant) and every other picked tree at `/upriv-saf-tree/<key>` (`key`: the first 16 bytes of SHA-256 of the trimmed tree URI, in hex), each through its own `SafTreeFs` bridge. A mount only binds the bridge and does no I/O, so a tree that is away fails on its first use, as that row's folder (failover applies). At module start and after each save the UI asks core for the trees this phone's rows name (`device_trees`) and Kotlin mounts them. The bridge answers `unavailable` for a tree whose drive does not answer, and `space` for free space.
- Mount the data folder's tree before any path RPC (`phoneDataFolder.ts`, `mountSelectedDataFolder`).
- Folder status `unreachable` means the grant is held and the volume does not answer. Shared UI maps it to the reconnect copy and blocks Continue. Only a phone produces it: on desktop a missing path cannot be told from a deleted folder.
- Android setup confirms Documents. The data folder created inside it is Documents/Upriv. Desktop rows stay filesystem paths. A Windows installer uses the user-data directory even when the install folder is writable. Portable exe and AppImage stay beside the program.
- A picker result that cannot host vaults fails at selection time and does not become the data folder.
- Export data folder, the vault export, and the backup export write straight into a folder the person picks, mounted on the same tree table (`exportTrees.ts`). Each field that keeps a picked folder (Export a copy, the vault `.zip`, the vault `.7z`, the backup export) holds its grant (`ExportFolderGrants`), so the folder stays for the next export, also after the window closes. A tree's mount and grant go once no field holds it, no export writes there (core reports the job ended), and no row of this phone names it. A picked tree inside a `.upriv` is refused by its address. A drive that stops answering under that folder fails the export; it is not the data folder's reconnect case. Never stage an export in `filesDir` or OS temp.
- A phone mounts no encrypted vault's unlocked folder. A plain-text vault writes into its unlocked folder inside a row's tree (`{tree}/upriv-unlocked/{vault name}`), or beside the data folder. Reveal opens a tree path in the Files app (`RevealInFileManager.kt` maps `/upriv-saf-root` and `/upriv-saf-tree/<key>` back to their documents).

---

## Desktop shell hardening — agent mindset

Upriv is an **offline desktop app**: valuable data lives on the **client’s PC**, not on Upriv servers. Shell controls (allowlist, CSP, stdio, graceful shutdown) are **not** “bank-grade remote security” — they are **product engineering** for boundaries, stability, and predictable development.

**Why keep them (default: keep, do not strip without reason):**

| Mechanism | Primary benefit | Not the main goal |
|-----------|-----------------|-------------------|
| stdio NDJSON (no TCP) | No open port; simple cross-platform transport | Blocking remote hackers |
| IPC routing | Electron forwards allowlisted methods to daemon; the **`upriv-rpc` `handle_rpc` match** is the product method gate; `ipcMain.handle` also rejects unknown names | Paranoid XSS defense |
| `SHELL_ONLY_RPC_COMMANDS` vs `CORE_RPC_COMMANDS` | Electron main vs Rust. The renderer allowlist is their union (`ELECTRON_IPC_METHODS`) | — |
| `app_shutdown` + `before-quit` | **Stability** — clean daemon exit, future vault flush | — |
| Single-instance lock | One app / one daemon — no lockfile fights | — |
| Structured RPC errors `{ code, message }` | UI/i18n consistency | — |
| CSP (production only) | Extra renderer boundary; low cost | Required in dev (Vite breaks) |
| `contextIsolation` + preload | Standard Electron — renderer cannot touch Node/fs | Optional extra |

**Real vault security** lives in **`upriv-core`**: crypto, RAM session, lockfiles, wipe, 7z gate. The shell must not implement vault logic — only enforce **clear edges** between React, Electron main, and `upriv-daemon`.

**When adding RPCs:** add shared op names to `@upriv/shared` `CORE_RPC_COMMANDS`, mobile-only ops to `MOBILE_ONLY_RPC_COMMANDS`, the handler in `upriv-rpc`, and a helper in desktop `lib/rpc.ts` and/or mobile `lib/rpc.ts`. A method the renderer calls also goes in `ELECTRON_IPC_METHODS` (`apps/electron/src/ipcMethods.ts`). Shell-only ops (`app_exit`, dialogs, reveal, terminal, WinFsp, FUSE) go in `SHELL_ONLY_RPC_COMMANDS` and Electron `main.ts` — never `upriv-rpc`. Electron main sends `app_shutdown` itself when the daemon should exit.

**When adding errors:** User-visible → `<domain>/errorMessages.ts` (or grouped files under a subfolder per §4.1). Domain `index.ts` re-exports only symbols used outside. See `ARCHITECTURE.md` §2.4.

**Do not assume** every hardening layer is mandatory for “security compliance.” **Do assume** removing allowlist/stdio/shutdown without replacement will hurt **maintainability and stability** as vault features land.

**Performance / universality:** these checks are negligible (Set lookups, headers). They do **not** block Linux/Windows/macOS or Android (JNI uses a different bridge, same RPC **contract**).

Details: [`dev/docs/ARCHITECTURE.md`](../dev/docs/ARCHITECTURE.md) §2.4.

---

## What agents should avoid

- Implementing vault/crypto in `apps/desktop/` or `upriv-daemon/` instead of `upriv-core`
- Adding Electron or HTTP server deps to `upriv-core`
- Hardcoding Portuguese/English UI strings in TS/Rust
- Treating an `encrypted_dir` vault's unlocked folder as a normal folder (it is a virtual mount)
- Copying desktop JSX verbatim to React Native
- Committing build artifacts under `target/`

---

## Quick PRD index

- §1 Vision, modes, states, v1 flow  
- §2 Use cases  
- §3 Functional requirements (+ §3.6 Android, §3.7 Desktop UX)  
- §4 Session  
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
- §14 Build status  
- §15 ADRs  

---

*Keep this file aligned when stack or layout changes. Update `dev/docs/VERSIONS.md` when pins change.*
