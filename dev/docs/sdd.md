# SDD — Upriv

**Language:** English (UI copy: `dev/docs/i18n/` — see `LOCALE.md`)

**Software Design Document**  
**Version:** 0.2  
**Date:** 2026-05-31  
**Companion:** PRD.md, `ARCHITECTURE.md`

---

## 1. Architectural overview

### 1.0 Layers (`archive` / `store` / `session` / `plain`)

| ID | Rust module | Disk | Session |
|----|-------------|------|---------|
| `archive` | `upriv_core::archive` | `vaults/<id>.7z` | — |
| `store` | `upriv_core::store` | `stores/<id>/` (encrypted) | — |
| `session` | `upriv_core::session` | — | mount `workspace/<id>/` + RAM |
| `plain` | `upriv_core::plain` | `workspace/<id>/` in plaintext | only when `storage.mode = plain` |

See PRD §11.1.

### 1.1 Principles

0. **v1 Linux only** — first delivery: desktop app on Linux (Tauri + `upriv-core` + FUSE). Vault layout and `.7z` remain portable; Windows/macOS/mobile later (PRD §3.5).
1. **Vault = folder + contract** — independent of where the executable is installed.
2. **Two product modes** — `encrypted_dir` (default; **v1**) and `plain` (exception; **v1.1+**, e.g. insufficient RAM). Do not treat the second as “legacy to discard”.
3. **Core in Rust** — single `upriv-core` crate for all platforms; shared logic between desktop and mobile (FFI). UI layers (React web, React Native) are **presentation only** — no crypto, disk I/O, or session secrets in JS/TS. See `ARCHITECTURE.md` §2.
4. **Declarative config** — `.upriv/settings.toml` + per-vault `vaults/<id>/config.toml`; safe defaults if missing.
5. **Mutable config** — vault options **changeable at any time**; TOML is source of truth; app re-reads before open/close (not “create and lock”).
6. **Fail safe** — never overwrite `vaults/<id>.7z` without validation; atomic writes.
7. **Password RAM only (v1)** — forbid `session.enc` / remember password on disk; after reboot, remount with password.
8. **Close = update `.7z`** — logical session content → `7zz` by stream; never pack `.enc` blobs from the store.
9. **Manifest** — `sync_generation` + hashes align `.7z` and store; recovery without silent overwrite.
10. **Unified states** — `open` | `closed` | `sealed`; `sealed` = only `.7z` in **both** modes.
11. **Virtual mount** — `workspace/` is not a data folder; I/O goes to encrypted `stores/<id>/`.
12. **Lockfile** — one open per vault at a time.
13. **Crypto standard** — Argon2id + AEAD; portability via 7z.

### 1.2 High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer                                 │
│  Tauri 2 + React web (desktop)        │  React Native (mobile) │
└─────────────────────────────┬───────────────────────────────┘
                              │ invoke (Tauri) / native module (RN)
┌─────────────────────────────▼───────────────────────────────┐
│                     upriv-core (Rust)                        │
│  VaultManager │ Config │ Session │ Recovery │ SevenZip       │
└─────────────────────────────┬───────────────────────────────┘
                              │ spawn / pipe
┌─────────────────────────────▼───────────────────────────────┐
│  encrypted_dir (v1) + plain (v1.1+) + 7zz      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│  stores/<id>/ (encrypted)  +  workspace/<id>/ (virtual)       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Vault state machine

### 2.0 Persisted states (unified — PRD §1.7)

**Central rule:** when **only `vaults/<id>.7z` exists**, `encrypted_dir` and `plain` share the **same** state: **`sealed`**.

| `persistence` | UI (i18n) | Disk | Modes |
|---------------|-----------|------|-------|
| `open` | `vault.status.open` | `.7z` + active work | both |
| `closed` | `vault.status.closed` | `.7z` + encrypted `stores/<id>/` | `encrypted_dir` only |
| `sealed` | `vault.status.sealed` | **only** `.7z` | both (`seal` close or `plain` close) |

```text
encrypted_dir:
  sealed ──open──► open ──close()──► closed ──seal()──► sealed
     ▲                 └────────seal()───────────────┘

plain (v1.1+):
  sealed ──open──► open ──close()──► sealed    (only resting close = sealed)
```

**Close actions (do not confuse with state):**

| Action | `storage.mode` | Resulting `persistence` |
|--------|----------------|-------------------------|
| `close` | `encrypted_dir` | `closed` |
| `seal` | `encrypted_dir` | `sealed` |
| `close` | `plain` | `sealed` (wipe plaintext workspace) |

Transient: `closing`, `recovery` — do not expose in UI as resting state.

```
                    ┌──────────┐     seal only      ┌──────────┐
                    │  SEALED  │◄──────────────────│  CLOSED  │
                    └────┬─────┘   (encrypted_dir) └────┬─────┘
                         │ open                         │ close
                         ▼                              ▼
                    ┌──────────┐◄────── close ──────────┘
         ┌─────────│   OPEN   │─────────┐
         │         └────┬─────┘         │ crash
         │ seal/close   │               ▼
         ▼              │          ┌───────────┐
    ┌──────────┐        │          │ RECOVERY  │
    │ CLOSING  │        │          └───────────┘
    └────┬─────┘        │
         └──────────────┴──► SEALED or CLOSED
```

### Runtime states (per vault)

| Runtime field | Values |
|---------------|--------|
| `session` | `open` \| `closing` \| `recovery` |
| `persistence` (after successful close) | `closed` \| `sealed` — also written to `manifest` |

`.upriv/runtime/state.json`: `vaults.<id>.session` while app runs.

**`open`:** only when `session == "open"` (lock + mount + key in RAM). Never infer `open` solely because `stores/<id>/` exists on disk.

**`closed` / `sealed`:** `manifest` + disk verification (§2.2).

### Critical transitions

**open (v1):**
1. Resolve `<vault-root>` via `--vault` or dialog.
2. Load config (defaults on failure).
3. Try to acquire `runtime/<id>.lock` — failure → `error.vault_already_open`.
4. `SevenZip::test(vaults/<id>.7z, password)` — failure → abort.
5. Read `manifest`; verify integrity (`archive_hash` vs `.7z`, `store_hash` vs encrypted tree).
6. Compute whether `closed` is valid: `persistence=="closed"` AND `last_store_write_at <= last_close_ok_at` AND hashes OK.
7. If `last_store_write_at > last_close_ok_at` or `.7z` replaced: **recovery** (do not assume `closed`).
8. If divergence: UI (`recovery.use_store` / `recovery.reimport_archive`) — RF-48.
9. If store missing or user chose re-import: materialize from `.7z` (ciphertext only on disk).
10. Derive key (Argon2id); `SessionHandle` RAM only; apply anti-swap policy where supported.
11. Mount `workspace/<id>/` **virtual** — **v1: FUSE (Linux)**; WinFSP / SAF in later phases (§2.4).
12. Update `runtime/state.json` → `vaults.<id>.session = "open"`.

**close (v1):**
1. Obtain password from `SessionHandle` in RAM (or prompt UI if expired).
2. **Gate:** `SevenZip::test(vaults/<id>.7z, password)` — failure → abort.
3. Flush encrypted store (`stores/<id>/`).
4. If `[backup] enabled`: move current `.7z` to `backup/<id>/<timestamp>-<id>.7z`.
5. `SevenZip::create_from_logical(vault_file.new, …)` — stream; `7zz` temp preferably in `tmpfs` (§2.6).
6. `SevenZip::test(vault_file.new, password)` — failure → abort.
7. Atomic rename: `vault_file.new` → `vaults/<id>.7z`.
8. Update `manifest`: `sync_generation++`; `archive_hash`; `store_hash`; `last_close_ok_at = now`; `last_store_write_at = last_close_ok_at`; `persistence`.
9. If action `close` (`encrypted_dir`): keep `stores/<id>/`; `manifest.persistence = "closed"`.
10. If action `seal`: `secure_wipe` on `stores/<id>/` or `workspace/<id>/`; delete cache; `manifest.persistence = "sealed"` (**same** in both modes when only `.7z` remains).
11. Unmount `workspace/<id>/`; release `runtime/<id>.lock`; remove entry in `state.json`.
12. `zeroize` password/keys in RAM.

**Reopen after reboot:** `open` with manifest; store reflects edits; `.7z` may lag until next successful close.

**open / close (`plain`, v1.1+):** classic flow — `7z t` → extract to plaintext `workspace/<id>/` → edit → on close: gate `7z t`, backup, `SevenZip::create` from `workspace/`, test `.new`, rename, **`secure_wipe_workspace`**, delete folder. Use when RAM cannot support mounted store or user explicitly chooses exception mode.

### 2.1 Password validation on close (`7z t` on old vault)

**Problem:** without this step, the user can close with a **different password** than the one used to open the vault. The app would generate a new valid `.7z`, but **incompatible** with history and with plan B (7-Zip on the old file would no longer open with the vault’s “correct” password).

**Rule:** before **any** write (backup or compression), test the password against the **current `vaults/<id>.7z`** (`7zz t -p{pass} …`). Continue only if the test passes.

| Situation | Behavior |
|-----------|----------|
| Wrong password | `error.wrong_password` in UI; `vaults/<id>.7z`, `backup/`, and `workspace/` **unchanged** |
| Correct password | Proceed backup (if enabled) → `.7z.new` → test `.new` → rename |
| First close (vault created this session, no `.7z` on disk yet) | Skip step 2; test only `.7z.new` after create |

**Why test the old file and not only the new:** the new archive is always created with the password the user just typed — it would pass the test even if it is **another** password. Testing the **existing** file ensures it is the **same** password as the vault that was open.

Related: PRD **RF-05**, **RF-39**; checklist §12; tests §13.2 (“wrong password on close”).

### 2.2 Manifest (sync `.7z` ↔ store)

File: `.upriv/stores/<id>/manifest.json` (inside store; deleted on `seal`).

**Sidecar after `seal`:** `.upriv/vaults/<id>.meta.json` (outside the deleted folder) with `persistence: "sealed"`, `archive_hash`, `sync_generation`, `sealed_at`. If absent: infer `sealed` when `<id>.7z` exists and `stores/<id>/` does not.

```json
{
  "format_version": 1,
  "sync_generation": 42,
  "archive_hash": "sha256:…",
  "store_hash": "sha256:…",
  "last_close_ok_at": "2026-05-28T14:00:00Z",
  "last_store_write_at": "2026-05-28T14:00:00Z",
  "persistence": "closed"
}
```

(`persistence`: `closed` | `sealed` at rest; `open` **never** in manifest — runtime only.)

**Hashes (integrity, not equality):**

| Hash | Computed over |
|------|---------------|
| `archive_hash` | Bytes of `vaults/<id>.7z` |
| `store_hash` | Encrypted tree manifest (`index/` + `data/` metadata) |

**Never** require `archive_hash == store_hash`.

**Sync “`.7z` matches store” (real `closed`):**

```rust
fn is_closed_real(m: &Manifest, store_on_disk: &StoreMeta) -> bool {
    m.persistence == Closed
        && store_on_disk.exists
        && m.last_store_write_at <= m.last_close_ok_at
        && m.archive_hash == hash_file(archive_path)
        && m.store_hash == hash_store_tree(store_path)
}
```

**During `open`:** each write-through sets `last_store_write_at = now()` → no longer satisfies `closed` until next close.

**Rules (`upriv-core::sync`):**

| Condition | Action |
|-----------|--------|
| `last_store_write_at > last_close_ok_at` (no session) | `recovery` — store stale vs last close |
| `archive_hash` ≠ hash of `.7z` on disk | `recovery` — `.7z` replaced |
| `store_hash` ≠ current hash | `recovery` — store corrupted or manual |
| Successful close | `sync_generation++`; both hashes; `last_close_ok_at = last_store_write_at = now` |

Related: PRD **RF-47**, **RF-48**, **RF-57**, §3.4.

### 2.3 Close actions (`close` vs `seal`)

Config in `config/<id>.toml` (default action in UI):

```toml
[close]
default_action = "close"   # "close" | "seal"  — only "close" valid in encrypted_dir
```

| Action | `encrypted_dir` → `persistence` | `plain` → `persistence` |
|--------|--------------------------------|----------------------------------|
| `close` | `closed` | *not available* (only destination = `sealed`) |
| `seal` | `sealed` | `sealed` |

**Close dialog (`encrypted_dir`, RF-53c):**

| UI option | Action | State | User-facing summary (i18n) |
|-----------|--------|-------|----------------------------|
| **`action.close`** | `close` | `closed` | `close.dialog.close_hint` |
| **`action.seal`** | `seal` | `sealed` | `close.dialog.seal_hint` |

`seal` requires extra confirmation (`close.dialog.seal_confirm`). In `plain`, single **`action.seal`** button → `sealed` (same state and UI label `vault.status.sealed`).

Related: PRD **RF-53**, **RF-53b**.

### 2.4 Virtual mount (`workspace/`)

**v1:** mount implementation **Linux (FUSE) only**. WinFSP (Windows) and DocumentProvider (Android) in later phases (PRD §3.5).

**Invariant:** in `encrypted_dir`, **never** create persistent regular files in `workspace/<id>/` on the vault volume.

```
App / Explorer  →  workspace/<id>/nota.txt  (logical path)
                        ↓ FUSE / WinFSP / DocumentProvider
                   CryptoLayer::read/write
                        ↓
                   stores/<id>/data/….enc   (only persistence)
```

- Read: decrypt stream → RAM → caller.
- Write: caller → encrypt stream → blob in store (**write-through**).
- `workspace/` is empty mountpoint until `open()`; after `close()`, unmounted (directory may exist empty).

**Write-through invariant (RF-49b):** after a successful `write()` / file `close()` on the mount, the corresponding logical content **is already** in the encrypted store on disk — there is no “RAM-only version” as source of truth.

| Event | Minimum guarantee |
|-------|-------------------|
| App writes and flush/`close` on handle | Updated encrypted blob in `stores/<id>/` |
| `fsync` on file (OS/editor) | Encrypted data on disk (not only app buffer) |
| Vault close | Global store `flush` + `.7z` export |

**Do not confuse:** read cache in RAM ≠ authoritative copy; on-disk authority is always the encrypted store after committed write.

**Required tests:** write via mount → no plaintext in real `workspace/` → ciphertext present in `stores/<id>/` before vault close.

Related: PRD **RF-49**.

### 2.5 Lockfile

- Path: `.upriv/runtime/<id>.lock` (PID + hostname + timestamp).
- Acquire at start of `open()`; release on `close()` and in crash recovery (optional stale TTL).
- Second `open` on same or other PC → clear error.

Related: PRD **RF-54**.

### 2.6 `.7z` export and `7zz` temp

- Prefer API/pipe that does not materialize tree in plaintext.
- If `7zz` requires temp: directory in `tmpfs` with `noswap` (Linux) or equivalent; delete at end of `close()` even on error (RAII guard).
- Never use `workspace/<id>/` as export staging.

Related: PRD **RF-45**, **RF-50**.

### 2.7 Swap minimization

- Decrypt/encrypt buffers and `SessionHandle`: `zeroize` on drop; `mlock`/`VirtualLock` where platform allows.
- Document: **do not** guarantee total absence of swap on Windows/macOS without elevated privileges.
- Future strict mode: discourage hibernation while vault open.

Related: PRD **RF-51**.

### 2.8 External editors

- Open files via mount path (do not copy outside by default).
- Optional hook: `warning.external_editor` on first open with external app.
- Config `allow_external_editors` / `restrict_to_internal_viewer` (see `prod/.upriv/vaults/*/config.toml`).
- Do not block user editing by default; inform about `%TEMP%`, thumbnails, etc. risk.

Related: PRD **RF-52**.

### 2.9 Backups (UI)

- Entry: **`action.backups`** button on vault row (PRD §3.7.2) → **modal** (not separate page).
- List `backup/<id>/*.7z`: **name**, **date** (mtime or timestamp in filename), optional size.
- Each modal row: **`action.delete`** button — active only after user types the vault **`id`** in confirmation field (same pattern as delete vault).
- Future actions in same list: restore (replace `.7z` + reimport store), open with 7-Zip.
- Backups are always `.7z` — direct plan B.

Related: PRD **RF-56**, **RF-UI-05**.

### 2.10 Secure deletion (`secure_wipe`)

> **`encrypted_dir` + virtual mount:** wipe on `workspace/` normally **not applicable** (no plaintext on disk).  
> **`seal` action:** wipe on `stores/<id>/` (`encrypted_dir`) or `workspace/<id>/` (`plain`) before delete.  
> **`persistence = sealed`:** same in both modes.

**Problem:** on HDD, `remove_file` / `rm -rf` **do not** erase bytes — only mark clusters free. On SSD, per-file wipe is best effort.

**Requirement:** after new `.7z` is written and validated, and **before** removing local cache on `seal`, overwrite + `fsync` + `unlink`.

**Algorithm (per file, order: deepest files first):**

```text
for each regular file in workspace/<id>/ (do not follow symlinks outside):
  1. open O_RDWR
  2. repeat wipe_passes times:
       write wipe_pattern (zeros or random) from offset 0 to file_size
  3. fsync(file)
  4. close
  5. remove_file
delete empty directories bottom-up
optional: fsync on workspace parent directory
```

**Suggested implementation (`upriv-core`):**

```rust
fn secure_wipe_path(path: &Path, opts: &WipeOptions) -> Result<()> {
    if path.is_symlink() { return Err(SymlinkNotAllowed); }
    if path.is_file() {
        wipe_file_contents(path, opts.passes, opts.pattern)?;
        std::fs::remove_file(path)?;
        return Ok(());
    }
    if path.is_dir() {
        for entry in WalkDir::new(path).contents_first(true) {
            secure_wipe_path(entry.path(), opts)?;
        }
        std::fs::remove_dir(path)?;
    }
    Ok(())
}
```

Linux: may delegate to `shred -u -n {passes} --random-source=/dev/urandom` if available; otherwise pure Rust implementation (portable Windows).

**Config (`config/<id>.toml` → `[security]`):**

```toml
[security]
mode = "session_ram"
secure_wipe_workspace = true   # default
wipe_passes = 1                # HDD: 1–3; more = slower, marginally stronger
wipe_pattern = "random"        # "random" | "zeros"
```

| Field | Default | Notes |
|-------|---------|-------|
| `secure_wipe_workspace` | `true` | If `false`, only `unlink` — **warn in UI** |
| `wipe_passes` | `1` | 3 passes on HDD for paranoia; unnecessary in many cases |
| `wipe_pattern` | `random` | `zeros` faster, slightly weaker |

**When to run the same wipe**

| Flow | Wipe? |
|------|-------|
| Successful `close()` | **Yes** (required if `secure_wipe_workspace`) |
| `DiscardWorkspace` (recovery) | **Yes** |
| Auto-close | Same as `close()` |
| Failure before step 7 (e.g. `7z t` failed) | **No** — workspace intact |
| Interruption during wipe | Workspace may be partial; recovery on next open |

**Limits (document to user)**

| Media | Guarantee |
|-------|-----------|
| **Mechanical HDD** | Well-done wipe ≈ **unrecoverable** for common tools |
| **SSD / flash** | **No guarantee** — wear leveling / TRIM; wipe = best effort |
| Unallocated volume space | Out of scope — does not wipe entire disk |
| External copies | Not affected |

**Do not:** `rm -rf workspace` without wipe when `secure_wipe_workspace = true`.

Related: PRD **RF-41–RF-44**; tests §13.2 (`secure_wipe` mock verifies overwrite before unlink).

---

## 3. File layout and configuration

### 3.1 `.upriv/settings.toml` (marker + app settings)

Single file at `.upriv/settings.toml`: paths, UI, logging, app preferences.

```toml
[package]
version = 1
label = "Upriv Demo"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"
workspace_dir = "workspace"
default_vault = "my-encrypted-notes"

[ui]
locale = "en"

[logging]
enabled = true
level = "info"
entries_per_file = 1000

[app]
auto_detect_vault_root = true
last_opened_vault = "my-encrypted-notes"
```

**Upriv marker:** folder is `<vault-root>` if it contains `.upriv/settings.toml`.

**Working root (UX):** `workspace/` + launchers (`Upriv-windows.exe`, `Upriv-mac`, `Upriv-linux`) and `.upriv/`; documentation in `README.md` at `<vault-root>` root.

**Bundle in repo:** `prod/` — four example vaults; **vault-oriented layout** (one folder per vault). Full spec: `prod/README.md`.

**Icons:** source in `app/assets/Upriv.svg`; `.ico`/`.icns` on root launchers = UI phase. **macOS:** v1 bundle = `macOS-arm64` only; `macOS-x64/` documented for Intel.

### 3.2 Vaults (`vaults/<vault_id>/`)

Each vault is a self-contained folder under `.upriv/vaults/<vault_id>/`:

```text
vaults/<vault_id>/              # vault_id = normalized slug (filesystem-safe)
├── config.toml                 # structural config
├── persistence.json            # closed | sealed (+ vault_id, display_name)
├── archive/<display_name>.7z   # Plan B — user filename verbatim
├── store/                      # encrypted_dir + closed (wiped on seal)
├── backups/                    # {timestamp}-{vault_id}.7z (app-generated)
└── auth/                       # plain + disk_open_close only
```

**Discovery:** scan `vaults/*/config.toml` on app start.

**List order:** sort vaults by `[vault] order` (ascending integer; lower = higher on screen). Vaults without `order` sort after those with an explicit value; tie-break by `display_name` (case-insensitive). Used primarily for the main vault list UI — does not affect paths or sync.

**Changing order in UI:** (1) vault settings modal — edit `[vault] order`; (2) **drag-and-drop** on the list — press/hold row (or drag handle), drag up/down, drop → app rewrites `order` on affected vaults atomically.

**Naming:**

| Field | Normalized? | Example |
|-------|-------------|---------|
| `vault_id` / folder name | Yes | `my-encrypted-notes` |
| `display_name` (UI, main `.7z` stem) | No — user input | `My Encrypted Notes` |
| `workspace/{display_name}/` while open | No | `workspace/My Encrypted Notes/` |
| `backups/*.7z` | Yes | `20260528T120000-my-encrypted-notes.7z` |

#### 3.2.1 `display_name` validation and export/import

**Forbidden in `display_name`** (and therefore in `archive/{display_name}.7z`): `\ / : * ? " < > |`, ASCII controls, empty/whitespace-only, trailing space or `.`, reserved Windows stems (`CON`, `PRN`, …), length > 128. Accents and internal spaces are allowed.

**`vault_id`:** always normalized slug (§3.2 table); generated from `display_name`; max 64 chars; collision suffix `-2`, …

**Export** (save `.7z` outside vault): default `{display_name}.7z`; if destination filename invalid, block or offer minimal sanitize (`-` replacement); **do not** change source vault `display_name`.

**Import** (external `.7z` → new vault): stem → proposed `display_name`; if invalid, dialog with `sanitize_minimal(stem)` pre-fill; user confirms; copy to `archive/{display_name}.7z`. Spec: `prod/README.md` § Forbidden characters.

Example `prod/.upriv/vaults/my-encrypted-notes/config.toml`:

```toml
[vault]
id = "my-encrypted-notes"
display_name = "My Encrypted Notes"
order = 1
vault_file = "archive/My Encrypted Notes.7z"
store_dir = "store"
backups_dir = "backups"
password_hint = ""   # optional; max 128 chars; reminder only — never the password
note = ""            # optional; max 256 chars; simple user annotation

[backup]
enabled = true
mode = "keep_last"

[security]
mode = "session_ram"
secure_wipe_workspace = true
wipe_passes = 1
wipe_pattern = "random"

[auto_close]
enabled = true
idle_minutes = 15
warn_before_seconds = 60
close_on_app_minimize = false

[seven_zip]
encrypt_file_names = true
archive_mode = "compress_encrypt"   # compress_encrypt | encrypt_only
compression_level = 5     # ignored if archive_mode = encrypt_only
solid = false
method = "lzma2"
```

**`archive_mode` on close** applies to both modes (`.7z` compression). **Default:** `encrypt_only` if omitted.

**`storage.mode` per vault:**

```toml
[storage]
mode = "encrypted_dir"          # v1 default
# mode = "plain"       # v1.1+ exception: insufficient RAM, very large vault

[close]
default_action = "close"        # "close" | "seal"
```

| Value | `7zz` (summary) | Use |
|-------|-----------------|-----|
| `encrypt_only` **(default)** | `-mx0 -m0=Copy` | Encrypt only (faster) |
| `compress_encrypt` | `-mx{N} -m0=lzma2` | Compress + encrypt |

**Discovery:** on start, app lists `config/*.toml` and builds map `id → VaultConfig`. No fixed list in code — new vaults = new `<id>.toml` file.

#### 3.2.2 Vault metadata: hint and note (storage decision)

User-facing metadata that is **not** sync state:

| Field | Where stored | Why |
|-------|--------------|-----|
| `order` | `config.toml` → `[vault]` | User-controlled display order in vault list; survives seal; optional (non-negative integer) |
| `password_hint` | `config.toml` → `[vault]` | Static, user-editable, survives seal; optional reminder at unlock |
| `note` | `config.toml` → `[vault]` | Short annotation; same lifecycle as vault config |
| Password (secret) | **RAM only** (v1 `encrypted_dir`) | RF-24 — never in any vault file |
| Sync hashes, generations | `persistence.json` | Operational manifest — rewritten on close |

**Not used for hint/note:**

| Location | Reason |
|----------|--------|
| `persistence.json` | Machine sync state (`sync_generation`, hashes, timestamps) — mixed concerns; file changes every close |
| Separate `notes.toml` / `meta.json` | Unnecessary for v1 — simple short text fits TOML; one less file to discover and migrate |

**Limits:**

| Field | Max length | Empty |
|-------|------------|-------|
| `order` | — (non-negative integer) | omit → sort after explicit values, then by `display_name` |
| `password_hint` | 128 chars | `""` or omit key → no hint shown |
| `note` | 256 chars | `""` or omit key → no note |

**Create-new wizard (not import):** password + confirm password (required); optional hint and note written to `[vault]` on first `config.toml` save.

**Unlock UI:** if `password_hint` non-empty, show below password field (`unlock.password_hint_label`). Never pre-fill password.

#### 3.2.3 Change password

Available in vault settings (`[security]` section in UI). Vault must be **open** (session active).

| Step | Action |
|------|--------|
| 1 | User enters **current password**, **new password**, **confirm new password** |
| 2 | UI shows **`warning.password_change_backups`** — existing `backups/*.7z` keep the password from when each snapshot was created |
| 3 | Validate current password (`7z t` on main archive + store unlock) |
| 4 | Re-encrypt store blobs and regenerate main `archive/{display_name}.7z` with new password (same atomic close pipeline) |
| 5 | Update `persistence.json` hashes / `sync_generation`; set `security.password_changed_at` in `config.toml` (ISO 8601 UTC) |
| 6 | **Do not** re-encrypt or delete existing `backups/` files automatically |

**Config after change:**

```toml
[security]
mode = "session_ram"
password_changed_at = "2026-05-30T18:00:00Z"   # omitted or empty until first change
```

Backups opened via Plan B or Upriv backups modal still require the **password active when that backup was taken**. Document in vault settings and backups modal footer.

Related: PRD **RF-58**, **RF-59**; i18n `vault.create.*`, `vault.change_password.*`, `warning.password_change_backups`.

#### 3.2.4 Mutable config (design requirement)

Configuration **is not immutable** after vault creation. User can change `[seven_zip]`, `[backup]`, `[auto_close]`, `[security]`, `[ui]` in `main.toml`, etc., **anytime** — via UI or by editing TOML.

```rust
struct ConfigStore {
    package: PackageConfig,           // main.toml + mtime
    vaults: HashMap<String, VaultEntry>, // id → { config, path, mtime }
}

struct VaultEntry {
    config: VaultConfig,
    path: PathBuf,      // config/<id>.toml
    mtime: SystemTime,
}

impl ConfigStore {
    fn reload_if_changed(&mut self, vault_root: &Path) -> Result<()>;
    fn vault(&self, id: &str) -> Result<&VaultConfig>;
}
```

**When to reload**

| Event | Action |
|-------|--------|
| App start / `--vault` | `load_all()` |
| User opens vault screen | `reload_if_changed(id)` |
| `config/<id>.toml` or `main.toml` changed (mtime) | invalidate cache; re-read on next use |
| UI saves settings | atomic TOML write (temp + rename) → update cache |

**When changes take effect**

| Field / section | Vault closed | Vault open |
|-----------------|--------------|------------|
| `[seven_zip]` (`archive_mode`, levels) | Next **close** | Next **close** (warn in UI) |
| `[backup]` | Next close | Next close |
| `[auto_close]` | Immediate on timer (recalculate `auto_close_at`) | Immediate |
| `[security]` (`secure_wipe_workspace`, `wipe_passes`, …) | Next **close** / discard | Immediate if only `mode`; wipe on close |
| `[vault] password_hint`, `[vault] note`, `[vault] order` | Immediate (UI / list) | Immediate |
| `[security] password_changed_at` | Set by change-password flow only | Set when change succeeds (vault open) |
| `[vault] id` / `vault_file` | Only with **migration flow** (rename `.toml`, `.7z`, folders) | **Block** — close vault first |
| `main.toml` `[package]` paths | Next open of any vault | Same |

**Forbidden**

- Assume config read only at vault creation.
- Eternal cache without checking TOML `mtime`.
- Rename `id` / `vault_file` with `workspace/<id>/` present without migration wizard.

**UI (v1+):** “Vault settings” screen edits same TOML (not parallel JSON structure that diverges).

**Name uniqueness and consistency (required):**

| Rule | Validation |
|------|------------|
| Unique `id` | No other `.toml`, `vaults/<id>.7z`, `auth/<id>/`, or `workspace/<id>/` with same name |
| File = `id` | `config/foo.toml` requires `[vault] id = "foo"` |
| Aligned triad | Same `id` in config, vaults, and auth; on create, fail if any already exists |
| Suggested charset | `[a-zA-Z0-9_-]+` (v1); reject `/`, `\`, `..`, reserved names (`runtime`, etc.) |

```rust
fn validate_vault_id(id: &str, vault_root: &Path) -> Result<()> {
    // 1. charset + reserved names
    // 2. config/{id}.toml exists and tom.id == id
    // 3. !vaults/<id>.7z exists OR is same vault being updated
    // 4. !workspace/<id> exists OR belongs to this vault (recovery)
    // 5. no duplicate ids across all loaded toml files
}
```

**Files per vault:**

| Path | Use |
|------|-----|
| `vaults/<id>.7z` | Closed vault (`vault_file` in TOML) |
| `backup/<id>/<timestamp>-<id>.7z` | Vault snapshot before close (`[backup]`) |
| `vaults/<id>.7z.new` | Temp on close |
| `auth/<id>/.session.enc` | Encrypted session (`disk_*` modes; hidden) |
| `auth/<id>/.quick-auth` | Quick-access blob (hidden; **never** plaintext password) |

**Open workspaces:** `workspace/<id>/` only while open; `runtime/state.json` lists open vaults (demo: several at once).

#### 3.2.5 Auto-close on inactivity

**Per-vault** configuration in `[auto_close]`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable automatic close |
| `idle_minutes` | u32 | `15` | Idle time until close (min. 1, max. 1440 suggested) |
| `warn_before_seconds` | u32 | `60` | Toast/dialog N seconds before; `0` = close directly |
| `close_on_app_minimize` | bool | `false` | If true, close on minimize (in addition to or instead of timer) |

**What resets the inactivity timer:**

1. Any Upriv UI action with that vault in focus.
2. Filesystem event in `workspace/<id>/` (create, modify, delete, rename) — debounce 2–5 s.
3. Return focus to app window with vault open (desktop).

**What does not reset:** editing another vault; mouse outside; HD merely connected.

**Runtime (`.upriv/runtime/state.json` per open vault):**

```json
{
  "last_activity_at": "2026-05-27T15:12:00-03:00",
  "auto_close_at": "2026-05-27T15:27:00-03:00"
}
```

Recalculate `auto_close_at = last_activity_at + idle_minutes` on each activity.

**Flow on trigger:**

```
idle expired
  → if warn_before_seconds > 0: notify; user can "action.continue" (resets timer)
  → else or after countdown: VaultManager::close(vault_id)
  → same pipeline as manual close (7z t, <id>.7z.new, remove workspace/<id>/)
```

**Suggested implementation (`upriv-core`):**

```rust
struct AutoCloseConfig {
    enabled: bool,
    idle: Duration,
    warn_before: Duration,
    close_on_minimize: bool,
}

struct AutoCloseHandle {
    vault_id: String,
    last_activity: Instant,
    deadline: Instant,
}

// Tauri: tokio interval 30s or notify + debounce on watcher
fn tick_auto_close(mgr: &mut VaultManager) {
    for c in mgr.open_vaults() {
        if !c.auto_close.enabled { continue; }
        if c.last_activity.elapsed() >= c.auto_close.idle {
            mgr.close_auto(c.id);
        }
    }
}
```

**Android:** timer in foreground service or `WorkManager` with care in Doze; filesystem via slower SAF polling — document limitation.

### 3.3 Path resolution

```rust
struct VaultRoot {
    root: PathBuf,  // absolute, canonicalized
}

impl VaultRoot {
    fn vaults_dir(&self, cfg: &PackageConfig) -> PathBuf {
        self.root.join(&cfg.vaults_dir)   // archives only
    }
    fn stores_dir(&self, cfg: &PackageConfig) -> PathBuf {
        self.root.join(&cfg.stores_dir)   // encrypted stores
    }
    fn store_path(&self, cfg: &PackageConfig, vault: &VaultConfig) -> PathBuf {
        self.stores_dir(cfg).join(&vault.store_dir)  // .upriv/stores/<id>/
    }
    fn workspace(&self, cfg: &PackageConfig, vault_id: &str) -> PathBuf {
        self.root.join(&cfg.workspace_dir).join(vault_id)
    }
    fn archive_path(&self, cfg: &PackageConfig, vault: &VaultConfig) -> PathBuf {
        self.vaults_dir(cfg).join(&vault.vault_file)  // .upriv/vaults/<id>.7z
    }
    fn auth_dir(&self, vault: &VaultConfig) -> PathBuf {
        self.root.join(&vault.auth_dir)  // .upriv/auth/<id>
    }
    fn session_path(&self, vault: &VaultConfig) -> PathBuf {
        self.auth_dir(vault).join(&vault.session_file)
    }
    fn state_path(&self, cfg: &PackageConfig) -> PathBuf {
        self.root.join(&cfg.runtime_dir).join("state.json")
    }
    fn app_dir(&self, cfg: &PackageConfig) -> PathBuf {
        self.root.join(&cfg.app_dir)  // .upriv/app
    }
    fn backup_dir(&self, cfg: &PackageConfig, vault_id: &str) -> PathBuf {
        self.root.join(&cfg.backup_dir).join(vault_id)
    }
    fn backup_filename(&self, vault_id: &str, closed_at: &DateTime<Utc>) -> String {
        format!("{}-{}.7z", closed_at.format("%Y%m%dT%H%M%S"), vault_id)
    }
}
```

**Rule:** all paths in config are **relative to `vault-root`**. Use `std::path` / `pathdiff` — never concatenate strings with `\`.

### 3.4 Defaults (no config)

```rust
const DEFAULTS: PackageConfig = PackageConfig {
    version: 1,
    vaults_dir: ".upriv/vaults",
    stores_dir: ".upriv/stores",
    auth_dir: ".upriv/auth",
    runtime_dir: ".upriv/runtime",
    workspace_dir: "workspace",
    security_mode: SecurityMode::SessionRam,
    seven_zip: SevenZipOptions {
        encrypt_file_names: true,
        archive_mode: ArchiveMode::EncryptOnly,  // default
        compression_level: 5,  // only if compress_encrypt
        solid: false,
    },
};
```

If a vault folder exists without `.upriv/settings.toml` → **Import vault** wizard or generate `settings.toml`.

---

## 4. `upriv-core` module (Rust)

### 4.1 Suggested crates

| Crate | Use |
|-------|-----|
| `serde`, `toml` | Config |
| `zeroize` | Clear password in memory |
| `argon2` or `scrypt` | Derive key for `session.enc` |
| `aes-gcm`, `rand` | Encrypt session blob |
| `anyhow`, `thiserror` | Errors |
| `tracing` | Logs (no password) |
| `directories` | App config (`last_vault`) outside vault |

### 4.2 Modules

```
upriv-core/
├── lib.rs
├── config/       # load main.toml, vaults/*.toml, defaults
├── vault/        # VaultManager: open, close, status
├── seven_zip/    # wrapper 7zz: test, extract, create
├── session/      # session.enc, SecurityMode
├── recovery/     # detect orphan, UI actions
└── paths/        # VaultRoot, canonicalize
```

### 4.3 Public interface (Rust)

```rust
pub struct VaultManager {
    root: VaultRoot,
    config: LoadedConfig,
    state: VaultState,
    session: Option<SessionHandle>,
}

impl VaultManager {
    pub fn discover(path: &Path) -> Result<Self>;
    pub fn create_new(root: &Path, password: &[u8]) -> Result<Self>;
    pub fn open(&mut self, password: &[u8]) -> Result<()>;
    pub fn close(&mut self, password: Option<&[u8]>) -> Result<()>;
    pub fn status(&self) -> VaultState;
    pub fn recovery_info(&self) -> Option<RecoveryInfo>;
    pub fn workspace_path(&self) -> PathBuf;
}
```

Exposed to desktop via Tauri `#[tauri::command]` and to mobile via React Native native module (JNI / iOS static lib). See `ARCHITECTURE.md` §2.3.

---

## 5. 7-Zip integration (`seven_zip` module)

### 5.1 Binary

- Bundle `7zz` per target triple:
  - `x86_64-pc-windows-msvc/7zz.exe`
  - `x86_64-unknown-linux-gnu/7zz`
  - `aarch64-apple-darwin/7zz` (macOS)
- Resolve path: `app_dir/bin/<platform>/7zz` or `PATH` fallback (dev only).

### 5.2 Commands

| Operation | Equivalent command |
|-----------|---------------------|
| Test password | `7zz t -p{pass} {id}.7z` |
| Extract | `7zz x -p{pass} -o{workspace} {id}.7z -y` |
| Create (`compress_encrypt`) | `7zz a -t7z -mhe=on -mx=5 -m0=lzma2 -ms=off -p{pass} <id>.7z.new workspace/<id>/*` |
| Create (`encrypt_only`) | `7zz a -t7z -mhe=on -mx=0 -m0=Copy -ms=off -p{pass} <id>.7z.new workspace/<id>/*` |

### 5.3 Password in process

- **Prefer:** password via **stdin** or temp file with restricted permissions (deleted immediately).
- **Avoid:** visible `-p` on command line in production (may appear in `ps`).
- Implementation: check `7zz` docs for `-si` / stdin password.

### 5.4 Fixed parameters (v1)

Do not expose to user in v1; read from `config/<id>.toml` with defaults:

| Field | Default |
|-------|---------|
| `encrypt_file_names` | `true` |
| `archive_mode` | **`encrypt_only`** |
| `compression_level` | `5` (only with `compress_encrypt`) |

---

## 6. Session and security modes

### 6.1 `SessionHandle` (RAM)

```rust
struct SessionHandle {
    password: Zeroizing<Vec<u8>>,
    // or derived_key if migrating to own crypto in future
}
```

Drop → zeroize.

### 6.2 `session.enc` (disk modes)

Suggested format (v0.1):

```
[magic: 4 bytes "VHDS"]
[version: u8]
[salt: 16 bytes]
[nonce: 12 bytes]
[ciphertext: variable]  // contains random session key (32 bytes)
```

- Derivation: Argon2id(password, salt) → key.
- Cipher: AES-256-GCM of session key.
- **Never** store UTF-8 password in `session.enc`.
- **Secure mode rule:** if `storage.mode = "encrypted_dir"`, `session.enc` and `.quick-auth` are forbidden.

### 6.3 Mode → behavior matrix

| Mode | open() | close() | reboot |
|------|--------|---------|--------|
| always_prompt | prompt password, no retention | prompt password | recovery prompts password |
| session_ram | retain SessionHandle | use handle | handle lost, prompt password |
| ram_on_close_only | prompt, zero after extract | prompt in UI, RAM only during close | same |
| disk_close | prompt; write session.enc | use session.enc | session.enc allows close |
| disk_open_close | session.enc after first unlock | use session.enc | same |

**Mandatory restriction in secure mode (`encrypted_dir`):**

- Allow only `always_prompt`, `session_ram`, `ram_on_close_only`.
- Block `disk_close` and `disk_open_close` in config validation.
- UI must not show “remember password” in `encrypted_dir` mode.

---

## 7. Recovery

### 7.1 Detection

On `VaultManager::discover` init:

```rust
fn detect_recovery(root: &VaultRoot) -> Option<RecoveryInfo> {
    let workspace_exists = root.workspace().exists();
    let state = read_state_json();
    let vault_exists = root.vault_path().exists();
    let partial_new = root.vault_path().with_extension("7z.new").exists();

    if workspace_exists && state != Open { Some(OrphanWorkspace) }
    else if partial_new { Some(IncompleteClose) }
    else { None }
}
```

### 7.2 Actions

| Action | Effect |
|--------|--------|
| `CloseWithPassword` | `7z t` → normal close |
| `DiscardWorkspace` | `secure_wipe` + delete `workspace/<id>/`, keep `vaults/<id>.7z` |
| `RestoreBackup` | copy latest backup from `backup/<id>/` → `vaults/<id>.7z` |

### 7.3 Reopen after crash (no RAM session, store still on disk)

**Typical case:** app quit, crash, or reboot — `state.json` is empty (`vaults: {}`), but `stores/<id>/` still exists with edits not yet exported to `.7z`.

```text
stores/<id>/ exists
state.json has no active session (not in RAM)
        │
        ▼
User Unlock → password
        │
        ▼
Validate manifest + hashes (§2.2)
        │
        ├─ store ahead of .7z → recovery UI first (RF-48)
        └─ OK → mount workspace/<id>/ (session in RAM only)
                    │
                    ▼
              User works / or chooses Close or Seal
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   action.close              action.seal
   7z t → new .7z           7z t → new .7z
   keep stores/<id>/        wipe stores/<id>/
   persistence: closed      vaults/<id>.meta.json
```

**Rules:**

- Do **not** require re-importing from `.7z` if the encrypted store is intact and the user accepts it (or hash check passes).
- Password is required to derive keys and mount — nothing sensitive restored from `state.json` alone.
- **Close** updates `.7z` and keeps `stores/<id>/` (fast reopen later).
- **Seal** updates `.7z`, wipes `stores/<id>/`, leaves only archive + optional `.meta.json` in `vaults/`.

**Not the same as `open` from sealed:** if only `vaults/<id>.7z` exists (no store), `open` materializes a new store from the archive first, then mounts.

Reference bundle: `prod/` — see `prod/README.md` (`settings.toml`, `vaults/<id>/`, `state.json`, `persistence.json`).

---

## 8. Desktop UI (Tauri 2)

### 8.1 Project structure

**Current scaffold:** see `ARCHITECTURE.md` §4:

```text
dev/
├── desktop/                    # React web UI (src/)
├── src-tauri/                  # Tauri shell → thin commands → upriv-core
│   ├── src/lib.rs
│   └── tauri.conf.json
├── mobile/                     # Expo / React Native scaffold
├── crates/upriv-core/          # Shared Rust (all platforms)
├── packages/shared/            # TS: types, hooks — future
└── docs/
```

### 8.2 Interface (v1 — specification)

**PRD:** §3.7 (RF-UI requirements). **v1 platform:** Linux + Tauri; **dark** theme; **minimalist** UX.

**i18n:** load `dev/docs/i18n/{locale}.json` per `[ui] locale` in `main.toml`. No hardcoded UI sentences in Rust/TS — see `LOCALE.md`.

#### 8.2.0 Design baseline (not final UI)

**`dev/docs/stitch_upriv_vault_manager/`** holds an exploratory **design baseline** (Stitch): `code.html`, `screen.png`, `DESIGN.md`, and `README.md`. Use it for **mood, layout ideas, and token starting points** only.

| Rule | Detail |
|------|--------|
| **Not final** | Not production UI; not wired to Tauri or `upriv-core` |
| **Not authoritative** | Behavior, flows, and copy come from **PRD §3.7**, **this section (§8.2)**, and **`dev/docs/i18n/`** |
| **Implementation** | Do not ship `code.html` as the app shell; replace hardcoded strings with i18n keys |

When the baseline and PRD/SDD conflict, **PRD/SDD win**. See `dev/docs/stitch_upriv_vault_manager/README.md`.

#### 8.2.1 Main screen — vault list

Single “home” screen: on launch, list **all vaults** in `<vault-root>` **centered** vertically/horizontally in window (scroll if many). Rows appear in **`[vault] order`** (ascending); tie-break by `display_name`.

**Reorder (v1+):** user may change order in two ways — (1) **`order`** field in vault settings (§8.2.4); (2) **drag-and-drop** on the list: press/hold a row (left grab handle or long-press on name), drag vertically, release → backend updates `[vault] order` for all moved vaults (atomic TOML writes). Drag handle must not fire row click or action buttons.

```
┌──────────────────────────────────────────────────────────────┐
│  Upriv                                          [+] New?   │  ← optional v1.1
├──────────────────────────────────────────────────────────────┤
│                                                              │
│     ┌────────────────────────────────────────────────────┐   │
│     │ ● vault-example-1  [💾] [⚙]  [  Unlock  ]          │   │  sealed/closed
│     └────────────────────────────────────────────────────┘   │
│     ┌────────────────────────────────────────────────────┐   │
│     │ ● vault-example-2 [💾][⚙]  [    Lock    ▼]          │   │  open + encrypted_dir
│     └────────────────────────────────────────────────────┘   │     ▲ highlighted row
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Row — layout**

| Position | Element | Behavior |
|----------|---------|----------|
| Left | `⋮⋮` drag handle (optional v1.1) + `●` dot + **name** | Handle = reorder (§ reorder above); dot = state color; name click = row click |
| Right (→) | **`action.backups`** | Modal §8.2.3 |
| | **`action.settings`** | Modal §8.2.4 |
| | **`action.lock`** / **`action.unlock`** | Primary visual: ~1.2× icon height; bold weight |
| | **▼** (split) | Only if `encrypted_dir` **and** `open`: menu **`action.seal`**; main button = **`action.close`** → `closed` |

Fixed order in right area: `Backups` → `Config` → `Lock|Unlock` → `▼`.

**Colors (dark theme — suggested tokens, tune in CSS):**

| State | Dot | Row (background/border) |
|-------|-----|-------------------------|
| `open` | `#3dd68c` | `border-left: 3px` + `background: rgba(61,214,140,.08)` |
| `closed` | `#6b8cff` | neutral (`--row-bg`) |
| `sealed` | `#8b8b8b` | `opacity: .85` or border `#5a5a5a` |
| `recovery` | `#f5a623` | `background: rgba(245,166,35,.12)` |

**Brand — wordmark color variants** (fixed exports in `.upriv/app/assets/`; PNG rasterized from matching SVG):

| Variant | Hex | Files | Use |
|---------|-----|-------|-----|
| White | `#FFFFFF` | `Upriv-wordmark-white.svg`, `Upriv-wordmark-white.png` | Dark UI, splash, default header on `#0f172a` |
| Black | `#000000` | `Upriv-wordmark-black.svg`, `Upriv-wordmark-black.png` | Light backgrounds, print |
| Navy | `#0B0E1E` | `Upriv-wordmark-navy.svg`, `Upriv-wordmark-navy.png` | Brand wordmark on light/neutral surfaces |

Default in-app header: **white** variant. App icon tile background: `#0f172a` (see `Upriv.svg` / `Upriv-icon.svg`). Dev UI assets: `dev/desktop/assets/`; on a shipped drive: `.upriv/app/assets/` (see `prod/.upriv/app/assets/README.md` for bundle layout only).

**Row interaction**

```text
click(row) && !click(button):
  if session == open      → vault_open_workspace(id)   // xdg-open workspace/<id>/ (runtime only)
  else                    → (nothing; use Unlock)

click(Unlock)              → modal/dialog password → open pipeline
click(Lock)                → close pipeline (→ closed by default in [close])
click(▼) → Seal            → seal pipeline + extra confirmation
click(Backups|Config)      → stopPropagation; open respective modal
```

**Close vs seal (`encrypted_dir`):**

- **`action.lock`** (single click): `close` → `persistence = closed` (keeps store).
- **▼ → `action.seal`:** `seal` → `persistence = sealed` (wipe store); confirmation: `close.dialog.seal_confirm`.
- In `plain`: only **`action.lock`** → seal directly (no dropdown, no `closed` state).

#### 8.2.2 Modals and auxiliary flows

| Flow | Type | When |
|------|------|------|
| **Unlock** | Dialog/modal | Unlock button or after creating vault |
| **Vault config** | Wide modal | ⚙ button |
| **Backups** | Medium modal | 💾 button |
| **Recovery** | Blocking modal | Detection on startup / listing |
| **Closing** | Overlay + progress | During `7zz` on close |

No separate Welcome screen in v1; “Open vault” = `--vault` on first run or app bar menu item (future).

#### 8.2.3 Modal — backups

- Title: `modal.backup.title` — `<id>`
- Table/list: columns **Name**, **Date**, **Actions**
- **Delete:** inline confirmation or second step with `<input>` — placeholder `modal.backup.delete_confirm` + `` `<id>` ``; button disabled until `input === id`.
- Suggested Tauri commands: `backup_list(id)`, `backup_delete(id, backup_name, confirm_id)`.

#### 8.2.4 Modal — vault settings

- Form generated from `config/<id>.toml` schema (collapsible sections).
- **`[vault]` section** includes **`order`** (integer) — same semantics as list sort; user may set position manually when not using drag-and-drop.
- **Save** → atomic TOML write + `config_reload`.
- Footer **`modal.settings.danger_zone`:** **`modal.settings.delete_vault`** button (red) → confirmation with `input === id` → `vault_delete(id, confirm_id)`.
- Detailed field content: **TBD** (product); modal structure stable from v1.

#### 8.2.5 Front-end components (suggestion)

```
ui/
  App.svelte|tsx
  VaultList.tsx          # sortable list; drag-and-drop reorder
  VaultRow.tsx           # row + colors + click + drag handle
  VaultLockButton.tsx   # Lock/Unlock prominent
  VaultSealMenu.tsx     # split ▼
  modals/
    VaultConfigModal.tsx
    VaultBackupsModal.tsx
    UnlockDialog.tsx
    RecoveryModal.tsx
  theme/
    dark.css            # tokens --row-*, --accent-*, --brand-*
```

**CSS tokens (suggested):**

```css
--brand-wordmark-white: #FFFFFF;
--brand-wordmark-black: #000000;
--brand-wordmark-navy:  #0B0E1E;
--brand-icon-bg:        #0f172a;
```

#### 8.2.6 Tauri commands (UI)

In addition to §8.3:

```rust
#[tauri::command]
fn vault_list(vault_root: String) -> Result<Vec<VaultRowDto>, String>;

#[tauri::command]
fn vault_reorder(vault_root: String, ordered_ids: Vec<String>) -> Result<(), String>;
// Accepts full list of vault ids in new display order; rewrites [vault] order on each config.toml (atomic).

#[tauri::command]
fn backup_list(vault_id: String) -> Result<Vec<BackupEntryDto>, String>;

#[tauri::command]
fn backup_delete(vault_id: String, backup_name: String, confirm_id: String) -> Result<(), String>;

#[tauri::command]
fn vault_delete(vault_id: String, confirm_id: String) -> Result<(), String>;

#[tauri::command]
fn vault_seal(vault_id: String, password: String) -> Result<(), String>;
```

`VaultRowDto`: `{ id, display_name, persistence, storage_mode, status_color, can_seal }`.

### 8.3 Tauri commands

```rust
#[tauri::command]
fn vault_open(vault_path: String, password: String) -> Result<(), String>;

#[tauri::command]
fn vault_close(vault_path: String, password: Option<String>) -> Result<(), String>;

#[tauri::command]
fn vault_open_workspace(vault_path: String) -> Result<(), String>;  // xdg-open / explorer

#[tauri::command]
fn vault_status(vault_path: String) -> Result<VaultStatusDto, String>;
```

### 8.4 CLI args

```
Upriv.exe --vault <path>
Upriv.exe --create <path>
```

**Root launcher** (demo = multi-OS stubs; **v1 production = Linux only**):

| OS | File | v1 | Behavior |
|----|------|-----|----------|
| Linux | `Upriv-linux` | **Yes** | → `.upriv/app/Linux-*/Upriv --vault <root>` |
| Windows | `Upriv-windows.exe` | No | → `.upriv/app/Windows-*/Upriv.exe` (v1.1+) |
| macOS | `Upriv-mac` | No | → `.upriv/app/macOS-arm64/Upriv.app` (v1.2+) |

```bat
"%~dp0.upriv\app\Windows-x64\Upriv.exe" --vault "%~dp0"
```

---

## 9. Mobile

### 9.1 Stack (Android v2 / iOS v3)

| Layer | Technology |
|-------|------------|
| UI | React Native + TypeScript |
| Bridge | Native module (JNI on Android; static lib + shim on iOS) |
| Core | `upriv-core` (same crate as desktop; compiled per target) |
| 7z | `7zz` ARM64 embedded in APK/IPA (`jniLibs` / assets) |

**Packaging:** one APK contains RN UI, bridge, `libupriv_core.so`, and `7zz` — not separate apps. **Rejected for mobile:** Tauri Android (experimental). **Superseded:** Flutter (see `ARCHITECTURE.md` ADR-02–04).

**Shared with desktop:** `dev/packages/shared/` (types, hooks, flows) and `dev/docs/i18n/` (strings) — not the same JSX/DOM as `dev/desktop/src/`.

### 9.2 Android — overview

Android **does not** run HD binaries like desktop. Model is:

1. **APK** distributed in `app/Android/Upriv.apk` (HD bundle) or outside → user **installs** once.
2. Installed app **binds** vault via **SAF** (persistent URI of HD root folder).
3. Vault layout **identical** to desktop: `.upriv/…` + `workspace/` at HD root.
4. File editing: **`action.open_folder`** button delegates to external manager via `Intent` — **no** full file manager inside Upriv.

**Decision (ADR):** `workspace/` folder stays **on vault volume (OTG)**, not internal-only cache, for desktop parity and folder Intents.

### 9.3 Android — installation and HD package

| Item | Behavior |
|------|----------|
| `.upriv/app/Android/Upriv.apk` | Installation artifact; tap opens Package Installer |
| Folder with “extracted” APK on HD | **Not supported** — Android does not run app as loose `dex`/`lib` folder on OTG |
| After install | APK on HD optional; app lives in system launcher |
| `7zz` | Inside APK (`arm64-v8a`); Rust core invokes binary in `context.getCacheDir()` or `nativeLibraryDir` per packaging |

### 9.4 Android — SAF and vault identification

**First run (bind vault):**

```text
Upriv (installed)
  → "Select vault" screen
  → Intent ACTION_OPEN_DOCUMENT_TREE
  → User chooses <vault-root> on OTG HD
  → Validate: .upriv/settings.toml exists AND vaults/<id>/ structure
  → takePersistableUriPermission(uri, READ|WRITE)
  → Save in local app config (SharedPreferences / file in filesDir):
        vault_tree_uri = "content://..."
```

**Discovery:** vault = `<vault-root>` whose SAF tree contains `.upriv/settings.toml`. Do not use absolute path `/storage/XXXX-XXXX/...` as source of truth.

**Abstraction in `upriv-core`:**

```rust
trait VaultStorage {
    fn read_file(&self, relative: &str) -> Result<Vec<u8>>;
    fn write_file(&self, relative: &str, data: &[u8]) -> Result<()>;
    fn list_dir(&self, relative: &str) -> Result<Vec<String>>;
    fn delete_tree(&self, relative: &str) -> Result<()>;
}
// Desktop: impl with std::fs::Path
// Android: impl with DocumentFile + ContentResolver
```

### 9.5 Android — workspace on HD

| State | `workspace/<id>/` (SAF) | `vaults/<id>.7z` |
|-------|-------------------------|------------------|
| CLOSED | absent | present |
| OPEN | present (extracted) | stale until close |
| CLOSING | present + `<id>.7z.new` | old + `.new` |
| RECOVERY | orphan may exist | old intact |

**open (Android):** same as desktop — `7zz t` → extract to `<vault-root>/workspace/<id>/` via SAF.

**close:** read `workspace/<id>/` → create `vaults/<id>.7z.new` → test → atomic rename → delete workspace.

**Internal cache:** temp only (`<id>.7z.new` if SAF rename problematic); **not** main workspace.

### 9.6 Android — “Open vault folder” (Intent)

PRD requirement **RF-A05**. Suggested implementation:

1. With vault OPEN, resolve URI of `workspace/` folder within vault tree:
   - `DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)` for `workspace` segment.
2. Build `Intent` (ACTION_VIEW or variant compatible with document URI).
3. `Intent.createChooser(intent, "Open vault folder")`.
4. User edits in external app (Google Files, Solid Explorer, X-plore, etc.).

**Fallback:** if no app accepts Intent, show message + link to install manager; optional v2: simple file list **inside** Upriv (read-only/open-with only).

**Do not do v1:** full explorer (copy, move, rename) inside Upriv.

### 9.7 Android — screens (v1)

| # | Screen | Actions |
|---|--------|---------|
| 1 | Welcome | Select vault / Last vault |
| 2 | Unlock | Password |
| 3 | Open | Status; **`action.open_folder`**; **Close vault** |
| 4 | Recovery | Password; Recompress / **`recovery.discard_workspace`** |
| 5 | Closing | Progress (7zz stdout if available) |

### 9.8 Android — app config (outside vault)

Store in Android app (not on HD):

```toml
[last]
vault_tree_uri = "content://com.android.externalstorage.documents/tree/primary%3A..."
```

**Do not** store password. Optional: `last_opened_vault = "vault-example-1"`.

### 9.9 Android — recovery and OTG

| Event | Detection | Action |
|-------|-----------|--------|
| USB disconnected with vault open | `workspace/` exists at previous URI but tree inaccessible | On reconnect: Recovery screen |
| App killed during close | `<id>.7z.new` present | Recovery: complete or discard `.new` |
| Orphan workspace | `workspace/` without app in foreground | `7z t` + close or discard |

### 9.10 Android — manual E2E tests

- [ ] Install APK from HD (OTG) → bind vault → open/close
- [ ] “Open folder” button opens manager at `workspace/` (≥2 apps)
- [ ] Edit file in manager → close vault → reopen → change persisted in `.7z`
- [ ] Disconnect OTG with vault open → reconnect → recovery
- [ ] Plan B: ZArchiver opens `vaults/<id>.7z` with same password
- [ ] Wrong password on close does not change `vaults/<id>.7z`

### 9.11 iOS (later phase, summary)

- Same vault layout on HD/cloud visible to Files.
- App **only** via App Store / TestFlight — **no** `app/iOS` binary on HD.
- Folder access via **UIDocumentPicker** / security-scoped bookmarks (analogous to SAF).
- Workspace on accessible volume when permission allows; Intent/limitations differ from Android.

---

## 10. App config (outside vault)

Location by OS:

| OS | Path |
|----|------|
| Linux | `~/.config/upriv/config.toml` |
| Windows | `%APPDATA%\Upriv\config.toml` |
| macOS | `~/Library/Application Support/Upriv/config.toml` |

Content:

```toml
[last]
vault_path = "/media/user/HD/my-vault"
```

**Do not** store password here.

---

## 11. Limits and validation

| Rule | Suggested value |
|------|-----------------|
| Workspace size before close | warn if > 3 GB |
| Free disk space | `free >= size(workspace) + size(vault_file) + 512MB` |
| Workspace name | block `..`, dangerous symlinks on extract |
| One default vault | v1; multiple in v1.1 |

---

## 12. Security — implementation checklist

- [ ] `7z t` before every `close` that writes
- [ ] Atomic write `.7z.new`
- [ ] `zeroize` password after close
- [ ] Logs without password or full sensitive paths
- [ ] `session.enc` never contains plaintext password
- [ ] UI warning for `disk_*` modes
- [ ] Do not follow symlinks when deleting workspace without care
- [ ] `secure_wipe_workspace` before removing `workspace/<id>/` (default on)
- [ ] `fsync` after each file overwrite (HDD)
- [ ] UI warns if `secure_wipe_workspace = false`
- [ ] Recovery `DiscardWorkspace` uses same wipe

---

## 13. Tests

### 13.1 Unit (Rust)

- Parse config + defaults
- Relative path resolution
- State machine transitions (mock seven_zip)

### 13.2 Integration

- Create vault temp dir → open → touch file → close → reopen
- Wrong password on close → vault_file unchanged
- Orphan workspace → recovery close
- Kill during close → orphan `.new`, original vault intact
- After close with wipe on HDD → forensic recovery **does not** restore workspace files (manual test with recovery tool)

### 13.3 Manual E2E

- exFAT HD Windows ↔ Linux
- 7-Zip opens app-generated `vaults/<id>.7z`

---

## 14. Implementation order (for AI/dev)

**v1 scope:** Linux only (PRD §3.5).

1. **`upriv-core`**: config load, paths, `SevenZip` wrapper with temp dir tests.
2. **FUSE** (Linux): mount `workspace/<id>/` → write-through to `store`.
3. **open/close** happy path without UI (Linux).
4. **Recovery** detector + discard.
5. **`7z t` gate** before write.
6. **Tauri** minimal (Linux): vault list (§8.2), Lock/Unlock, config/backups modals, row click → workspace.
7. **Linux packaging**: bundle `7zz` (`Linux-x64` / `aarch64`), `Upriv-linux`, `hd-bundle` template.
8. **session.enc** + disk modes (v0.2).
9. **Windows** Tauri + WinFSP (v1.1).
10. **macOS** (v1.2).
11. **React Native Android** (`dev/mobile/`): native module → `upriv-core`; SAF; workspace on HD; open/close; Intent “Open folder”; single APK.
11b. **Auto-close**: timer + FS watch per vault; warning UI.
12. **React Native iOS**: document picker + same core.

---

## 15. Recorded decisions (ADR summary)

| Decision | Choice | Reason |
|----------|--------|--------|
| Container | `.7z` AES-256 | Universality, plan B |
| vs own format v1 | No | Time, trust in 7z |
| Core language | Rust | Security, FFI, Tauri |
| Desktop UI | React web + Tauri 2 | Stable executables Linux/Win/Mac (x86 + ARM); validated `.exe` + AppImage (2026-05-31) |
| Mobile UI | React Native | Single APK/IPA; TS structure shared with desktop; not Tauri Android |
| UI security boundary | Presentation only in JS/TS | Crypto, RAM, disk, 7z in `upriv-core` only |
| v1 platform | Linux desktop | Reduce surface (FUSE, packaging); portable vault from day one |
| Config | TOML + defaults | Readable, cross-platform |
| Password on HD | Only `session.enc` | Never plaintext |
| Vault location | `--vault` path | HD + system folder |
| Android workspace | On HD (SAF) | Desktop parity; Intent for external FM |
| Android distribution | APK in `.upriv/app/Android/` | Mandatory install; not loose “folder app” |
| Vault root | `.upriv/` groups system | UX: `workspace/` + 3 launchers at root |
| Android file editing | Intent to manager | Avoid full FM in Upriv v1 |
| Hint + note storage | `config.toml` `[vault]` | User metadata; survives seal; not sync manifest |
| Change password | Re-encrypt archive + store; backups unchanged | Historical snapshots keep old password by design |

---

## 16. Technical references

- [7-Zip command line](https://sevenzip.osdn.jp/chm/cmdline/index.htm)
- [Tauri 2](https://v2.tauri.app/)
- [React Native](https://reactnative.dev/)
- `ARCHITECTURE.md` in this repository (cross-platform stack, ADRs)
- PRD.md in this repository

---

*This SDD should be read together with PRD.md. Any AI or developer can start with the `upriv-core` crate and open/close integration tests.*
