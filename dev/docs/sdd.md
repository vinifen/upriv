# SDD — Upriv

**Language:** English (UI copy: `dev/apps/shared/locales/` — see `LOCALE.md`)

> **Rest layout, storage modes, backups, and export:** [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md). `contents/` at rest; lock = close; FUSE/WinFsp (desktop) or in-app file manager (mobile) while open.

> **Workspace mount (current):** app `[workspace].path` + vault `[mount].workspace_path` → `{parent}/{display_name}/`. Not auto-created at init. See `.agent/AGENT.md`. Older mentions of fixed `workspace/<id>/` under the vault-root are **legacy** until rewritten.

**Software Design Document**  
**Version:** 0.2  
**Date:** 2026-05-31  
**Companion:** PRD.md, `ARCHITECTURE.md`

---

## 1. Architectural overview

### 1.0 Layers (`contents/` / `session` / `plain`)

| ID | Rust module | Disk | Session |
|----|-------------|------|---------|
| `contents` | `upriv_core::store` (planned) | `vaults/<id>/contents/` (ciphertext) | — |
| `session` | `upriv_core::session` (planned) | — | mount `workspace/<id>/` + RAM (`encrypted_dir`) |
| `plain` | `upriv_core::plain` (planned) | `workspace/<id>/` in plaintext | only when `storage.mode = upriv_plain` |

No `archive/` layer. Portable `.zip` / `.7z` are **export files**, not rest layout. See PRD §1.6 and SECURITY-CRYPTO.

### 1.1 Principles

0. **v1 Linux + Windows** — first delivery: desktop app on Linux and Windows (Electron + `upriv-daemon` + `upriv-core`; FUSE on Linux, WinFsp on Windows). Design the virtual-mount layer as a shared trait from day one. Mobile uses the in-app file manager (no FUSE).
1. **Vault = folder + contract** — independent of where the executable is installed.
2. **Two storage modes** — `encrypted_dir` (default) and `upriv_plain`. Rest is always `contents/`. Lock = close.
3. **Core in Rust** — single `upriv-core` crate for all platforms; shared logic between desktop and mobile (FFI). UI layers (React web, React Native) are **presentation only** — no crypto, disk I/O, or session secrets in JS/TS. See `ARCHITECTURE.md` §2.
4. **Declarative config** — `.upriv/settings.toml` + per-vault `vaults/<id>/config.toml`; safe defaults if missing.
5. **Mutable config** — vault options **changeable at any time**; TOML is source of truth; app re-reads before open/close (not “create and lock”).
6. **Fail safe** — never overwrite `contents/` without verification; atomic writes. Never leave a durable `.7z` twin beside `contents/`.
7. **Password default in RAM (v1)** — default `session_ram` (lock does not re-ask); optional `disk_*` modes write **encrypted** `session.enc` (never plaintext password); after reboot without `session.enc`, remount with password. `always_prompt` is an opt-in presence check on lock, not a rewrap.
8. **Close = flush session into `contents/`** — never pack `.enc` blobs into a `.7z` as rest. Export `.7z` streams **logical** content.
9. **Recovery** — dirty close / leftover `upriv_plain` workspace / dead header → resume `contents/`, wipe plaintext, or create from backup. No archive-vs-store picker.
10. **Unified states** — `open` (runtime) | `closed` (rest).
11. **Virtual mount** — in `encrypted_dir`, `workspace/` is not a data folder; I/O goes to encrypted `contents/`.
12. **Lockfile** — one open per vault at a time.
13. **Crypto standard** — Argon2id + XChaCha20-Poly1305 in `contents/`; optional `.7z` export for interoperability (weaker guessing). Do not claim “more secure than 7-Zip.”

### 1.2 High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer                                 │
│  Electron + React web (desktop)       │  React Native (mobile) │
└─────────────────────────────┬───────────────────────────────┘
                              │ RPC (upriv-daemon) / native module (RN)
┌─────────────────────────────▼───────────────────────────────┐
│                     upriv-core (Rust)                        │
│  VaultManager │ Config │ Session │ Recovery │ contents crypto │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│  encrypted_dir (RAM/FUSE)  or  upriv_plain (workspace/)      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│  vaults/<id>/contents/  +  workspace/<id>/ (virtual or plain) │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Vault state machine

### 2.0 Persisted states (unified — PRD §1.7)

**Central rule:** rest is **`contents/`**. Persistence on disk is always **`closed`**. **`open` is runtime only.** There is **no `sealed`**.

| `persistence` | UI (i18n) | Disk | Modes |
|---------------|-----------|------|-------|
| `open` | `vault.status.open` | session + `contents/` | both (`upriv_plain`: plaintext workspace + `contents/`) |
| `closed` | `vault.status.closed` | encrypted `contents/` | `encrypted_dir`, `upriv_plain` |

```text
encrypted_dir / upriv_plain:
  closed ──open──► open ──close()──► closed
  # never writes a rest .7z; seal is not available
  # upriv_plain open: plaintext workspace (wipe on close)
```

**Close actions (do not confuse with state):**

| Action | `storage.mode` | Resulting `persistence` |
|--------|----------------|-------------------------|
| `close` (lock) | `encrypted_dir`, `upriv_plain` | `closed` |

Transient: `closing`, `opening`, `recovery` — do not expose in UI as resting state.

```
                    ┌──────────┐
                    │  CLOSED  │
                    └────┬─────┘
                         │ open
                         ▼
                    ┌──────────┐
         ┌─────────│   OPEN   │─────────┐
         │         └────┬─────┘         │ crash / leftover plaintext
         │ close        │               ▼
         ▼              │          ┌───────────┐
    ┌──────────┐        │          │ RECOVERY  │
    │ CLOSING  │        │          └───────────┘
    └────┬─────┘        │
         └──────────────┴──► CLOSED
```

### Runtime states (per vault)

| Runtime field | Values |
|---------------|--------|
| `session` | `open` \| `closing` \| `recovery` |
| `persistence` (after successful close) | `closed` only — also written to persistence sidecar; **no `sealed`** |

`.upriv/runtime/state.json`: `vaults.<id>.session` while app runs.

**`open`:** only when `session == "open"` (lock + mount + key in RAM). Never infer `open` solely because `contents/` exists on disk.

**`closed`:** header + index verification on `contents/`.

### Critical transitions

**open (v1):**
1. Resolve `<vault-root>` via `--vault` or dialog.
2. Load `vaults/<id>/config.toml`.
3. Try to acquire `runtime/<id>.lock` — failure → `error.vault_already_open`.
4. Read `vault.header`; derive master key (Argon2id from header params) — failure → abort.
5. Verify index / chunk tags needed for the session.
6. If dirty close or leftover `upriv_plain` workspace: **recovery** (resume `contents/`, wipe workspace, or create from backup).
7. `encrypted_dir`: mount `workspace/<id>/` **virtual** — FUSE (Linux) + WinFsp (Windows); mobile uses the in-app file manager (no FUSE).
8. `upriv_plain`: decrypt into plaintext `workspace/<id>/`.
9. Update `runtime/state.json` → `vaults.<id>.session = "open"`.

**close (v1):**
1. Use keys from `SessionHandle` in RAM (or `session.enc` in disk modes). Prompt the UI **only** for `always_prompt` — a presence check against the open session / `vault.header`, never a new wrap. Default lock has no password field.
2. Flush the session into `contents/` (header + index + chunks). Never pack `.enc` blobs into a `.7z` as rest.
3. If `[backup] enabled`: copy `contents/` to `backups/<stamp>/`.
4. `upriv_plain`: `secure_wipe_workspace` and remove plaintext `workspace/<id>/` (UI confirms wipe on manual lock).
5. Unmount `workspace/<id>/`; release `runtime/<id>.lock`; remove entry in `state.json`.
6. `zeroize` password/keys in RAM.

**Reopen after reboot:** `open` against `contents/`; edits from the last successful close are in the ciphertext tree.

### 2.1 Session integrity on close (not a new password)

**Problem (legacy `.7z` rest):** close used to re-pack an archive from a typed password. A different password on close would rewrite wrap material incompatibly with prior backups.

**Rule now:** close **flushes with the open session keys**. A typed password is **not** an input to wrap `vault.header`. RF-05 is header/session integrity before backup or flush.

| Situation | Behavior |
|-----------|----------|
| Default / `session_ram` / `disk_*` | Lock with session keys (or `session.enc`); no password field |
| `always_prompt` + wrong password | `error.wrong_password`; `contents/` and backups **unchanged** (presence check only) |
| `always_prompt` + correct password | Same flush as default — still the **open** session, not a rewrap |
| Session gone (crash / process exit) | Recovery against `contents/` — do not ask a close password to “finish” a dead session |
| First close of a vault created this session | Header already written at create; validate session key |

Related: PRD **RF-05**, **RF-39**; checklist §12; tests §13.2 (“wrong password on close” = `always_prompt` presence check).

### 2.2 Persistence / integrity (no Seal twin)

File: `.upriv/vaults/<id>/persistence.json` beside `config.toml` (not inside a deleted store).

There is **no** Seal sidecar, **no** durable `archive/` twin, and **no** `archive_hash`. Sync metadata that remains: `content_hash`, `last_close_ok_at` (recovery A). Canonical detail: [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md).

```json
{
  "format_version": 1,
  "content_hash": "sha256:…",
  "last_close_ok_at": "2026-05-28T14:00:00Z",
  "persistence": "closed"
}
```

(`persistence`: `closed` at rest only; `open` is **never** persisted — runtime session only.)

**Rules (`upriv-core`):**

| Condition | Action |
|-----------|--------|
| Dirty close / leftover `upriv_plain` workspace | `recovery` |
| Header/index unreadable | Create new vault from backup only |
| One chunk tag fail | That file; vault still opens |
| Successful close | Update `content_hash` + `last_close_ok_at` |

Related: PRD **RF-47**, **RF-48**, **RF-57**, §3.4.

### 2.3 Close action

Lock is always **close** (flush the session into `contents/`). There is no Seal.

| Action | `encrypted_dir` | `upriv_plain` |
|--------|-----------------|---------------|
| `close` | `closed` | `closed` (wipe plaintext workspace) |

Related: PRD **RF-53**, **RF-53b**.

### 2.4 Virtual mount (`workspace/`)

**v1:** mount implementation **Linux (FUSE) + Windows (WinFsp)**. DocumentProvider (Android) in later phases (PRD §3.5).

**Invariant:** in `encrypted_dir`, **never** create persistent regular files in `workspace/<id>/` on the vault volume.

**RAM:** session serves decrypted bytes from RAM; the full unlocked vault working set must fit available memory (see **`warning.encrypted_dir_ram`** and §3.2.2).

```
App / Explorer  →  workspace/<id>/nota.txt  (logical path)
                        ↓ FUSE / WinFsp / DocumentProvider
                   CryptoLayer::read/write
                        ↓
                   vaults/<id>/contents/data/….enc   (only persistence)
```

- Read: decrypt stream → RAM → caller.
- Write: caller → encrypt stream → chunk in `contents/` (**write-through**).
- `workspace/` is empty mountpoint until `open()`; after `close()`, unmounted (directory may exist empty).

**Write-through invariant (RF-49b):** after a successful `write()` / file `close()` on the mount, the corresponding logical content **is already** in `contents/` on disk — there is no “RAM-only version” as source of truth.

| Event | Minimum guarantee |
|-------|-------------------|
| App writes and flush/`close` on handle | Updated encrypted chunk in `contents/` |
| `fsync` on file (OS/editor) | Encrypted data on disk (not only app buffer) |
| Vault close | Global flush of session into `contents/` |

**Do not confuse:** read cache in RAM ≠ authoritative copy; on-disk authority is always `contents/` after committed write.

**Required tests:** write via mount → no plaintext in real `workspace/` → ciphertext present in `contents/` before vault close.

Related: PRD **RF-49**.

#### 2.4.1 Encrypted contents — file and folder names (forensic resistance)

In `encrypted_dir`, **logical paths must not appear in plaintext** under `vaults/<id>/contents/` on HD/SSD. Forensic inspection of the tree alone must not reveal what each blob represents (e.g. `passwords.txt` vs `photo.jpg`).

**On-disk layout (example):**

```text
contents/
├── vault.header          # format + KDF params + wrapped key (no cleartext tree)
├── index/root.idx.enc    # encrypted directory tree (paths + metadata)
└── data/<opaque>/….chunk.enc   # content ciphertext; opaque identifiers only
```

**Crypto (see [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md)):**

| Layer | Cipher | What it protects |
|-------|--------|------------------|
| Content blobs | `XChaCha20-Poly1305` (default) | File bytes |
| Path / name index | `AES-SIV` (`name_cipher`) | File and folder names, tree structure |

**Rules:**

- Never persist logical paths as human-readable filenames under `contents/data/`.
- Index updates are write-through with content (same session key).
- Logical names are visible only in the **virtual mount** / in-app file manager while the vault is **open** (session), not as durable plaintext on the vault volume.

**Portable `.7z` export:** `[seven_zip] encrypt_file_names = true` by default — names hidden inside the export file too. Disabling it is a deliberate downgrade (UI warning). Export is not rest layout.

Related: PRD §3.3.1, **RF-45**, **RF-49**, **RF-49b**.

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
- Each modal row: **`action.delete`** (confirm with vault `id`), **`action.create_vault_from_backup`** (+ → create-vault wizard with backup path pre-filled), **`action.download`**.
- **No in-place restore** — backups are snapshots for download or seeding a **new** vault import; the source vault is unchanged.
- Backups are always `.7z` — direct plan B.

Related: PRD **RF-56**, **RF-UI-05**.

### 2.10 Secure deletion (`secure_wipe`)

> **`encrypted_dir` + virtual mount:** wipe on `workspace/` normally **not applicable** (no plaintext on disk).  
> **`upriv_plain`:** wipe plaintext `workspace/<id>/` on close (and before delete).

**Problem:** on HDD, `remove_file` / `rm -rf` **do not** erase bytes — only mark clusters free. On SSD, per-file wipe is best effort.

**Requirement:** before removing a plaintext `upriv_plain` workspace, overwrite + `fsync` + `unlink`.

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

[ui]
locale = "en"
theme = "dark"
show_header_more_button = true
file_manager_dock_expanded = false
# always_show_hidden_vaults = false          # optional; Hidden vaults section
# vault_list_allow_drag_into_group = true    # optional
# vault_list_show_drag = true                # optional
# vault_list_sort = "order"                  # optional; see table below
# vault_list_sort_direction = "asc"          # optional
# vault_list_view = "default"                # optional
# vault_list_search = ""                     # optional
# vault_list_show_create_button = true       # optional

[logging]
enabled = true
level = "info"
entries_per_file = 1000
keep_last_entries = 10000

[app]
last_opened_vault = "my-encrypted-notes"
# Vault-root mode (`default_root` | `custom_root`): app-home `.upriv-root`, not here.
# Missing/inactive → default_root; active + path → custom_root.
```

**Upriv marker:** folder is `<vault-root>` if it contains `.upriv/settings.toml`.

**Vault-root location:** `vault_root_mode` / custom path are **not** `[app]` keys in TOML (stripped on write). They are derived from the app-home `.upriv-root` file and exposed on the settings RPC wire as `app.*` fields for the UI only. (Obsolete boolean mode fields in old TOML are ignored.)

#### `[ui]` — fields and where they are saved (v1 desktop)

**On disk:** prefs are **flat keys under `[ui]`**. General UI (`locale`, `theme`, `show_header_more_button`, `file_manager_dock_expanded`, `always_show_hidden_vaults`) then `vault_list_*` list prefs. Legacy nested **`[ui.vault_list]`** still loads; save writes flat `[ui]`. **`show_header_more_button`** is the on-disk name for the header ⋮ (wire: `vault_list_show_header_more_button`).

**Wire / RPC:** flat `settings.ui.*` below (what TypeScript and the daemon exchange).

| Wire key | TOML (on disk) | Edited in System settings modal? | When persisted |
|-----|----------------|----------------------------------|----------------|
| `locale` | `[ui].locale` | Yes (Language) | Explicit **Save** in System settings |
| `theme` | `[ui].theme` | Yes (General) | Explicit **Save** in System settings |
| `vault_list_show_header_more_button` | `[ui].show_header_more_button` | Yes (General) | Explicit **Save** in System settings. Default `true`. Shows the header overflow (⋮) menu. |
| `file_manager_dock_expanded` | `[ui].file_manager_dock_expanded` | **No** | When user **expands or collapses** the minimized file-manager dock (bottom-right chip list). Restored on next app launch. Default `false` (collapsed — count button only). |
| `always_show_hidden_vaults` | `[ui].always_show_hidden_vaults` | Yes (Hidden vaults) | Explicit **Save** in System settings |
| `vault_list_show_drag` | `[ui].vault_list_show_drag` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows vertical drag grips on the vault list; off hides grips only (order/sort unchanged). |
| `vault_list_show_create_button` | `[ui].vault_list_show_create_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the new-vault (+) button. |
| `vault_list_show_search_button` | `[ui].vault_list_show_search_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the search button. A saved `vault_list_search` still filters when hidden. |
| `vault_list_show_sort_button` | `[ui].vault_list_show_sort_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the sort button. Current sort stays in effect when hidden. |
| `vault_list_show_view_button` | `[ui].vault_list_show_view_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the view button. Current view stays in effect when hidden. |
| `vault_list_show_vault_more_button` | `[ui].vault_list_show_vault_more_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the vault row overflow (⋯) menu. |
| `vault_list_show_vault_settings_button` | `[ui].vault_list_show_vault_settings_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the vault row settings (gear) menu. |
| `vault_list_show_group_settings_button` | `[ui].vault_list_show_group_settings_button` | Yes (Groups) | Explicit **Save** in System settings. Default `true`. Shows the group header settings gear. Legacy combined TOML key: `vault_list_show_vault_group_settings_button` (applies to both when the split keys are missing). |
| `vault_list_allow_drag_into_group` | `[ui].vault_list_allow_drag_into_group` | Yes (Groups) | Explicit **Save** in System settings. Default `true`. Drop vault onto group to assign / onto list to ungroup. |
| `vault_list_sort`, `vault_list_sort_direction` | `[ui].vault_list_sort*` | No | When user changes sort on the vault list toolbar |
| `vault_list_view` | `[ui].vault_list_view` | No | When user toggles list view on the vault list toolbar |
| `vault_list_search` | `[ui].vault_list_search` | No | When the user types in the vault-list search box (debounced). The control expands only while focused. Filters ungrouped vault names, group names, and vaults inside groups. |

**Minimized file-manager dock:** after **Minimize** on a file-manager modal, vault chips appear in a floating dock. One control toggles between showing all chips vs. a single collapsed button with the count. That expanded/collapsed choice is written to `[ui] file_manager_dock_expanded` immediately on toggle — not exposed as a checkbox in System settings.

**Working root (UX):** `workspace/` + launchers (`Upriv-windows.exe`, `Upriv-mac`, `Upriv-linux`) and `.upriv/`; documentation in `README.md` at `<vault-root>` root.

**Bundle in repo:** `prod/` — four example vaults; **vault-oriented layout** (one folder per vault). Full spec: `prod/README.md`.

**Icons:** source in `app/assets/Upriv.svg`; `.ico`/`.icns` on root launchers = UI phase. **macOS:** v1 bundle = `macOS-arm64` only; `macOS-x64/` documented for Intel.

### 3.2 Vaults (`vaults/<vault_id>/`)

Each vault is a self-contained folder under `.upriv/vaults/<vault_id>/`:

```text
vaults/<vault_id>/              # vault_id = normalized slug (filesystem-safe)
├── config.toml                 # structural config
├── persistence.json            # closed (+ vault_id, display_name)
├── contents/                   # rest — vault.header + index + chunks
├── backups/                    # frozen copies of contents/ (`<stamp>/`)
└── (optional) workspace leftovers only for dirty upriv_plain
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
| `backups/<stamp>/` | Yes | frozen `contents/` copy |

#### 3.2.1 `display_name` validation and export/import

**Forbidden in `display_name`** (and therefore in `{display_name}.zip` / `{display_name}.7z` export names): `\ / : * ? " < > |`, ASCII controls, empty/whitespace-only, trailing space or `.`, reserved Windows stems (`CON`, `PRN`, …), length > 128. Accents and internal spaces are allowed.

**`vault_id`:** always normalized slug (§3.2 table); generated from `display_name`; max 64 chars; collision suffix `-2`, …

**Export** (save outside vault): default `{display_name}.zip` (zip of encrypted `contents/`) or `{display_name}.7z`; if destination filename invalid, block or offer minimal sanitize (`-` replacement); **do not** change source vault `display_name`.

**Import** (external `.zip` of `contents/` or `.7z` → new vault): stem → proposed `display_name`; if invalid, dialog with `sanitize_minimal(stem)` pre-fill; user confirms. Spec: `prod/README.md` § Forbidden characters.

Example `prod/.upriv/vaults/my-encrypted-notes/config.toml`:

```toml
[vault]
id = "my-encrypted-notes"
display_name = "My Encrypted Notes"
order = 1
password_hint = ""   # optional; max 128 chars; reminder only — never the password
note = ""            # optional; max 10000 chars; user annotation

[backup]
enabled = true
mode = "keep_last"
keep_last = 1

[security]
mode = "session_ram"              # default; lock uses session keys (no password). UI: 4 password-memory choices (§3.2.3a)
secure_wipe_workspace = true      # UI: Security
wipe_passes = 1                   # hidden default
wipe_pattern = "random"           # hidden default
# password_changed_at = "..."     # set by app on change-password; omit until first change

[auto_close]
enabled = true
idle_minutes = 15
warn_before_seconds = 60
close_on_app_exit = false

[seven_zip]
encrypt_file_names = true
archive_mode = "compress_encrypt"   # compress_encrypt | encrypt_only
compression_level = 5     # ignored if archive_mode = encrypt_only
solid = false
method = "lzma2"
```

**`archive_mode` / `compression_level` on close** apply whenever a `.7z` is written. **Default:** `encrypt_only` + level ignored (UI preset **none**).

**UI compression presets** (map to TOML; settings + create wizard):

| Preset | `archive_mode` | `compression_level` (`7zz -mx`) |
|--------|----------------|--------------------------------|
| `none` | `encrypt_only` | `0` |
| `low` | `compress_encrypt` | `1` |
| `medium` | `compress_encrypt` | `5` |
| `high` | `compress_encrypt` | `9` |

**`storage.mode` per vault:**

```toml
[storage]
mode = "encrypted_dir"   # encrypted_dir | upriv_plain
# encrypted_dir — rest = contents/; open: decrypt in RAM (FUSE / in-app FM)
# upriv_plain  — rest = contents/; open: plaintext workspace; lock closes + wipe
```

**RAM capacity (`encrypted_dir`):** decrypted logical content is held in **RAM** while the vault is **open**. **`upriv-core`** must treat insufficient memory as a **hard failure** — open, edit, or close abort with a user-visible error; **never** silently spill plaintext workspace to disk in `encrypted_dir` (RF-49). UI: **`warning.encrypted_dir_ram`**, **`warning.upriv_plain`**. When RAM cannot fit the vault, split vaults or choose **`upriv_plain`**.

| Value | `7zz` (summary) | Use |
|-------|-----------------|-----|
| `encrypt_only` **(default)** | `-mx0 -m0=Copy` | Encrypt only (faster) — UI preset **none** |
| `compress_encrypt` | `-mx{N} -m0=lzma2` | Compress + encrypt — UI presets **low/medium/high** |

**Discovery:** on start, app lists `config/*.toml` and builds map `id → VaultConfig`. No fixed list in code — new vaults = new `<id>.toml` file.

#### 3.2.2 Vault metadata: hint and note (storage decision)

User-facing metadata that is **not** sync state:

| Field | Where stored | Why |
|-------|--------------|-----|
| `order` | `config.toml` → `[vault]` | User-controlled display order in vault list; optional (non-negative integer) |
| `password_hint` | `config.toml` → `[vault]` | Static, user-editable; optional reminder at unlock |
| `note` | `config.toml` → `[vault]` | User annotation; same lifecycle as vault config |
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
| `note` | 10000 chars | `""` or omit key → no note |

**Create-new wizard (not import):** password + confirm password (required); optional hint and note written to `[vault]` on first `config.toml` save.

**Unlock UI:** if `password_hint` non-empty, show below password field (`unlock.password_hint_label`). Never pre-fill password.

#### 3.2.3 Change password

Available in vault settings (**Security** section in UI; stored fields span `[vault]` hint + `[security]` metadata). Works with vault **open or closed** — user **always** enters the **current password** (never inferred from session alone without explicit confirmation in this flow).

**Why closed is allowed:** the operation only needs the current password to decrypt the main archive and store, re-encrypt in RAM/disk temp, then atomically replace files. An open session is **not** required.

| Step | Action |
|------|--------|
| 1 | User enters **current password**, **new password**, **confirm new password** (new ≠ current) |
| 2 | UI shows **`warning.password_change_backups`** — existing `backups/<stamp>/` keep the password from when each snapshot was created |
| 3 | **`upriv-core`:** validate current password against `contents/` header; re-wrap keys |
| 4 | **If vault open:** keep user workspace available; decrypt store + workspace path in controlled temp/RAM; do not leave plaintext on disk when `encrypted_dir` |
| 5 | **If vault closed:** extract archive + store to temp workspace in RAM (or encrypted temp per policy); no user-facing mount required |
| 6 | **Optional (recommended):** snapshot current main `.7z` into `backups/` **before** replace (uses **old** password — consistent with backup semantics) |
| 7 | Re-encrypt `contents/` with the **new** password (same atomic flush as close) |
| 8 | Secure-delete superseded session temp; remove stale plaintext |
| 9 | Update `persistence.json` hashes / `sync_generation`; set `[security] password_changed_at` (ISO 8601 UTC) |
| 10 | **If vault was open:** refresh in-memory session with new password; remount FUSE if applicable |
| 11 | **Do not** re-encrypt or delete existing `backups/` files automatically |

**Config after change:**

```toml
[security]
mode = "session_ram"
password_changed_at = "2026-05-30T18:00:00Z"   # omitted or empty until first change
```

Backups opened via Plan B or Upriv backups modal still require the **password active when that backup was taken**. Document in vault settings and backups modal footer.

**Desktop UI (v1, implemented in mock):** expandable panel under Security — `vault.change_password.*`, `warning.password_change_backups`, `modal.settings.change_password_help`. Submit calls `vault_change_password` RPC when wired.

Related: PRD **RF-58**, **RF-59**; i18n `vault.change_password.*`, `warning.password_change_backups`.

#### 3.2.3a Vault settings UI — field visibility (v1 desktop)

Settings modal edits `config.toml` but **does not mirror every key** — advanced or system-owned values stay in TOML with defaults.

| TOML section | Shown in UI | Hidden in UI (defaults / system) |
|--------------|-------------|----------------------------------|
| `[vault]` | `display_name`, `order`, `note`, `password_hint` | `id` (folder slug; derived/normalized on rename migration). Layout dirs `contents/` and `backups/` are not TOML keys. |
| `[storage]` | `mode` (`encrypted_dir` / `upriv_plain`) + contextual warnings | — |
| `[auto_close]` + `[security].secure_wipe_workspace` | **Preferences / Lock and idle:** secure wipe, idle auto-close | — |
| `[security]` | **`mode` (password in memory — 4 UI options for all storage modes)** | `wipe_passes`, `wipe_pattern`, `password_changed_at` (set by app). `secure_wipe_workspace` is shown under Lock and idle, not as a `[security]` form field. |
| Password / Unlock RAM | Settings **areas** (not TOML sections): change password; change Argon2id preset | Cost lives in `contents/vault.header`, never a `[kdf]` section |
| `[seven_zip]` | compression preset (**none/low/medium/high** → `archive_mode` + `compression_level`), `encrypt_file_names` | `method`, `solid` (defaults: `lzma2`, `false`) |
| `[policy]` | `allow_external_editors`, `disallow_copy_outside_mount` (two radio groups) | `require_unmount_on_sleep` |

**Password in memory (UI):** `session_ram` (lock without retyping), Never save (`always_prompt` — presence check on lock; does not rewrap), `disk_close` (less secure), `disk_open_close` (insecure) — **same list for all storage modes**. Legacy TOML `ram_on_close_only` loads/saves as `session_ram`. Disk modes use `auth/<id>/.session.enc` (encrypted key blob).

**Storage mode warnings (UI):**

| `storage.mode` | Warning key | When shown |
|----------------|-------------|------------|
| `encrypted_dir` | `warning.encrypted_dir_ram` | Storage section (settings + create wizard); Help → Security |
| `upriv_plain` | `warning.upriv_plain` | Storage section; badge **Insecure**; plaintext while open |

Related: PRD **RF-UI-17**, §1.6.

**Modal UX (unlike note/backups modals):** explicit **Save** (enabled only when dirty) → confirm save; close with dirty draft → **discard all and close** confirm; backdrop/Esc while confirm open cancels close attempt.

Related: PRD **RF-UI-04**, **RF-UI-15**.

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
| `[security] password_changed_at` | Set when change-password succeeds | Set when change-password succeeds (open or closed) |
| `[vault] id` | Only with **migration flow** (rename folder + `config.toml`) | **Block** — close vault first |
| `main.toml` `[package]` paths | Next open of any vault | Same |

**Forbidden**

- Assume config read only at vault creation.
- Eternal cache without checking TOML `mtime`.
- Rename `id` with a session present without a migration wizard.

**UI (v1+):** “Vault settings” screen edits same TOML (not parallel JSON structure that diverges).

**Name uniqueness and consistency (required):**

| Rule | Validation |
|------|------------|
| Unique `id` | No other `vaults/<id>/`, `config.toml`, or mount folder with the same slug |
| File = `id` | `config/foo.toml` requires `[vault] id = "foo"` |
| Aligned triad | Same `id` in config, vaults, and auth; on create, fail if any already exists |
| Suggested charset | `[a-zA-Z0-9_-]+` (v1); reject `/`, `\`, `..`, reserved names (`runtime`, etc.) |

```rust
fn validate_vault_id(id: &str, vault_root: &Path) -> Result<()> {
    // 1. charset + reserved names
    // 2. config/{id}.toml exists and tom.id == id
    // 3. !vaults/<id>/ exists OR is same vault being updated
    // 4. !workspace/<id> exists OR belongs to this vault (recovery)
    // 5. no duplicate ids across all loaded toml files
}
```

**Files per vault:**

| Path | Use |
|------|-----|
| `vaults/<id>/contents/` | Vault body at rest |
| `vaults/<id>/backups/<stamp>/` | Frozen copy of `contents/` (`[backup]`) |
| `auth/<id>/.session.enc` | Encrypted session (`disk_*` modes; hidden) |

**Open workspaces:** `workspace/<id>/` only while open; `runtime/state.json` lists open vaults (demo: several at once).

#### 3.2.5 Auto-close on inactivity

**Per-vault** configuration in `[auto_close]`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable automatic close |
| `idle_minutes` | u32 | `15` | Idle time until close (min. 1, max. 1440 suggested) |
| `warn_before_seconds` | u32 | `60` | Toast/dialog N seconds before; `0` = close directly |
| `close_on_app_exit` | bool | `false` | If true, close open vaults when the app quits (independent of idle timer) |

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
    close_on_app_exit: bool,
}

struct AutoCloseHandle {
    vault_id: String,
    last_activity: Instant,
    deadline: Instant,
}

// Desktop daemon: tokio interval 30s or notify + debounce on watcher
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
    fn vault_dir(&self, vault_id: &str) -> PathBuf {
        self.vaults_dir().join(vault_id)
    }
    fn vault_contents_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("contents")
    }
    fn vault_backups_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("backups")
    }
    fn vault_config_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("config.toml")
    }
}
```

**Rule:** all paths in config are **relative to `vault-root`**. Use `std::path` / `pathdiff` — never concatenate strings with `\`.

### 3.4 Defaults (no config)

```rust
const DEFAULTS: PackageConfig = PackageConfig {
    version: 1,
    vaults_dir: ".upriv/vaults",
    runtime_dir: ".upriv/runtime",
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
| *(logging)* | Structured `.upriv/logs/` via `logging::Logger` / `log_event` (no passwords) |
| `directories` | App config (`last_vault`) outside vault |

### 4.2 Modules

```
upriv-core/
├── lib.rs
├── config/       # load main.toml, vaults/*.toml, defaults; settings.toml [ui] / [logging]
├── logging/      # Logger / log_event → `.upriv/logs/`; session, store, writer; RPC log_*
├── vault/        # VaultManager: open, close, status
├── seven_zip/    # wrapper 7zz: test, extract, create
├── session/      # session.enc, SecurityMode
├── recovery/     # detect orphan, UI actions
├── paths/        # VaultRoot, canonicalize
├── mount/        # Virtual workspace trait; FUSE (Linux), WinFsp (Windows)
└── plain/        # Plaintext workspace open/close + secure_wipe (v1)
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
    pub fn close(&mut self, password: Option<&[u8]>) -> Result<()>; // None = session keys; Some = always_prompt check only
    pub fn status(&self) -> VaultState;
    pub fn recovery_info(&self) -> Option<RecoveryInfo>;
    pub fn workspace_path(&self) -> PathBuf;
}
```

Exposed to desktop via `upriv-daemon` stdio JSON-RPC and to mobile via React Native native module (JNI / iOS static lib). See `ARCHITECTURE.md` §2.3.

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
- **Both storage modes:** `session.enc` allowed when `security.mode` is `disk_close` or `disk_open_close`; forbidden for RAM-only modes. `.quick-auth` never stores plaintext password.

### 6.3 Mode → behavior matrix

| Mode | open() | close() | reboot |
|------|--------|---------|--------|
| always_prompt | prompt password; do not retain the **string** | prompt as presence check against the open session (do not rewrap); idle auto-close skipped | recovery prompts password |
| session_ram | retain SessionHandle | use handle; **no prompt** | handle lost, prompt password |
| ram_on_close_only | *(legacy)* treat as `session_ram` on load/save | use handle; **no prompt** | same as `session_ram` |
| disk_close | prompt; write session.enc | use session.enc; **no prompt** | session.enc allows close |
| disk_open_close | session.enc after first unlock | use session.enc; **no prompt** | same |

**`encrypted_dir` + disk session modes:**

- `disk_close` / `disk_open_close` are **allowed** (user opt-in; UI badges less-secure / insecure).
- **Default** remains `session_ram`.
- Store encryption and encrypted file names are **unchanged** — disk modes only affect password/session convenience via `auth/`.
- Never write UTF-8 password to `session.enc` or settings files.

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
| `DiscardWorkspace` | `secure_wipe` + delete leftover plaintext `workspace/`; keep `vaults/<id>/contents/` |
| `RestoreBackup` | copy `backups/<stamp>/` (frozen `contents/`) into a **new** vault — never overwrite the source |

### 7.3 Reopen after crash (no RAM session, `contents/` still on disk)

**Typical case:** app quit, crash, or reboot — `state.json` is empty (`vaults: {}`), but `vaults/<id>/contents/` still holds the last flushed ciphertext (and recovery may need dirty-close / leftover `upriv_plain` workspace handling).

```text
vaults/<id>/contents/ exists
state.json has no active session (not in RAM)
        │
        ▼
User Unlock → password
        │
        ▼
Validate header + index (§2.2)
        │
        ├─ dirty close / leftover workspace → recovery UI first
        └─ OK → mount workspace/<id>/ (session in RAM only)
                    │
                    ▼
              User works / chooses Close
                    │
                    ▼
              action.close → flush session into contents/
              persistence: closed
```

**Rules:**

- Do **not** require re-importing from a portable `.7z` if `contents/` is intact and checks pass.
- Password is required to derive keys and mount — nothing sensitive is restored from `state.json` alone.
- **Close** flushes the session into `contents/` and leaves the vault closed (no Seal).
- Portable `.zip` / `.7z` export remains a separate user action, not rest layout.

**Dead header/index:** create a **new** vault from a backup stamp or contents zip — do not invent Seal recovery.

Reference: [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md). Canonical greenfield layout — `prod-example/` is stale.


## 8. Desktop UI (Electron)

### 8.1 Project structure

**Current scaffold:** see `ARCHITECTURE.md` §4:

```text
dev/
├── apps/
│   ├── desktop/                # React web UI (src/)
│   ├── mobile/                 # Expo / React Native scaffold
│   ├── electron/               # Electron shell (main/preload)
│   └── shared/                 # @upriv/shared — TS domain + service interfaces (no React)
├── crates/
│   ├── upriv-core/             # Shared Rust (all platforms)
│   └── upriv-daemon/           # Desktop RPC → upriv-core
└── docs/
```

### 8.2 Interface (v1 — specification)

**PRD:** §3.7 (RF-UI requirements). **v1 platform:** Linux + Windows + Electron; **dark** theme; **minimalist** UX.

**i18n:** load `dev/apps/shared/locales/{locale}.json` per `[ui] locale` in `main.toml`. No hardcoded UI sentences in Rust/TS — see `LOCALE.md`.

#### 8.2.1 Main screen — vault list

Single “home” screen: on launch, list **all vaults** in `<vault-root>` **centered** vertically/horizontally in window (scroll if many). Rows appear in **`[vault] order`** (ascending); tie-break by `display_name`.

**Reorder (v1+):** user may change order in two ways — (1) **`order`** field in vault settings (§8.2.4); (2) **drag-and-drop** on the list: press/hold a row (left grab handle or long-press on name), drag vertically, release → backend updates `[vault] order` for all moved vaults (atomic TOML writes). Drag handle must not fire row click or action buttons.

```
┌──────────────────────────────────────────────────────────────┐
│  Upriv                                          [+] New?   │  ← optional v1.1
├──────────────────────────────────────────────────────────────┤
│                                                              │
│     ┌────────────────────────────────────────────────────┐   │
│     │ ● vault-example-1  [💾] [⚙]  [  Unlock  ]          │   │  closed
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

Fixed order in right area: `Backups` → `Config` → `Lock|Unlock`.

**Colors (dark theme — suggested tokens, tune in CSS):**

| State | Dot | Row (background/border) |
|-------|-----|-------------------------|
| `open` | `#3dd68c` | `border-left: 3px` + `background: rgba(61,214,140,.08)` |
| `closed` | `#6b8cff` | neutral (`--row-bg`) |
| `recovery` | `#f5a623` | `background: rgba(245,166,35,.12)` |

**Brand — wordmark color variants** (fixed exports in `.upriv/app/assets/`; PNG rasterized from matching SVG):

| Variant | Hex | Files | Use |
|---------|-----|-------|-----|
| White | `#FFFFFF` | `Upriv-wordmark-white.svg`, `Upriv-wordmark-white.png` | Dark UI, splash, default header on `#0f172a` |
| Black | `#000000` | `Upriv-wordmark-black.svg`, `Upriv-wordmark-black.png` | Light backgrounds, print |
| Navy | `#0B0E1E` | `Upriv-wordmark-navy.svg`, `Upriv-wordmark-navy.png` | Brand wordmark on light/neutral surfaces |

Default in-app header: **white** variant. App icon tile background: `#0f172a` (see `Upriv.svg` / `Upriv-icon.svg`). Dev UI assets: `dev/apps/desktop/assets/`; on a shipped drive: `.upriv/app/assets/` (see `prod/.upriv/app/assets/README.md` for bundle layout only).

**Row interaction**

```text
click(row) && !click(button):
  if session == open      → vault_open_workspace(id)   // xdg-open workspace/<id>/ (runtime only)
  else                    → (nothing; use Unlock)

click(Unlock)              → modal/dialog password → open pipeline
click(Lock)                → close pipeline (→ closed)
click(Backups|Config)      → stopPropagation; open respective modal
```

**Lock:**

- **`action.lock`** (single click): `close` → `persistence = closed`.

#### 8.2.2 Modals and auxiliary flows

| Flow | Type | When |
|------|------|------|
| **Unlock** | Dialog/modal | Unlock button or after creating vault |
| **Vault config** | Wide modal | ⚙ button |
| **Backups** | Medium modal | 💾 button |
| **Recovery** | Blocking modal | Detection on startup / listing |
| **Closing** | Overlay + progress | During `7zz` on close |
| **Opening** | Overlay + progress | During `7zz` test / decrypt / mount on unlock |

**Open/close/seal pipelines (v1):** one global **FIFO queue** — only one `7zz` (or equivalent) runs at a time; further requests wait. UI may show progress in a blocking overlay first, then **Continue in background** so the list stays usable; queued vaults show `opening` / `closing` on their row until their turn completes. No mid-pipeline cancel (abort would risk inconsistent disk state). Desktop UI implements the FIFO queue in `useVaultPipelineRun`; pipeline steps are still **mock** until `upriv-core` vault RPCs land.

**Pipeline — erros e anti-travamento (pendente ao wirear `upriv-core`):**

| Área | Já existe (mock / infra) | Falta quando for `7zz` real |
|------|--------------------------|------------------------------|
| **Fila FIFO** | `useVaultPipelineRun` — enfileira, status `opening`/`closing` na lista | RPC `vault_open` / `vault_close` / `vault_seal` no daemon; progresso por passo vindo do Rust |
| **Erros user-facing** | `VaultPipelineError` + i18n; overlay + toast; `revertCloseFailure` no close | Espelhar códigos Rust em `VAULT_ERROR_CODES` + `vault-lifecycle/errors/codes.ts`; erros reais (`wrong_password`, `archive_test_failed`, …) |
| **Sem cancel no meio** | SDD + PRD RF-UI-10 | Manter — abort mid-`7zz` arrisca disco inconsistente |
| **Cancel na fila** | Não implementado (v1) | Opcional futuro: remover job **antes** de iniciar `7zz`; limpar senha em RAM |
| **Timeout IPC** | `desktopInvokeRaw` 30s; `daemonRpc` 30s; spawn daemon 10s | **Timeout por operação de vault** no `upriv-core` (open/close podem levar minutos — valor TBD, ex. 30–60 min) |
| **Kill subprocesso** | `stopDaemon` mata o processo inteiro | Se `7zz` travar: matar **só** o child, devolver `RpcError` estruturado, liberar slot da fila |
| **Estado após falha** | Close mock reverte `session` | Wrong password / timeout no close **não alteram** `contents/` (PRD); limpar temp/workspace conforme SECURITY-PLAINTEXT (nunca `.7z.new` como rest) |
| **Fila após erro** | `dismissFailure()` segue para o próximo | Garantir que timeout/kill no Rust também completa o job com erro (não deixa slot ocupado para sempre) |

**Checklist implementação (um PR por camada ou PR único coordenado):**

1. **Rust:** spawn `7zz` com timeout configurável; códigos de erro estáveis; nunca deixar `.7z` / workspace em estado ambíguo.
2. **Daemon:** handlers RPC de lifecycle; repassar progresso (evento ou polling) se overlay precisar de passos reais.
3. **Shared:** `VAULT_ERROR_CODES` deixa de ser `planned`; sync com `upriv-rpc`.
4. **Desktop:** `createDesktopServices()` delega `runOpeningPipeline` / `runClosingPipeline` ao RPC (substituir `runTimedPipeline` mock).
5. **Testes:** integração stdio com pipeline que falha (senha errada, timeout simulado); UI não fica `opening`/`closing` eternamente.

No separate Welcome screen in v1; “Open vault” = `--vault` on first run or app bar menu item (future).

#### 8.2.3 Modal — backups

- Title: `modal.backup.title` — `<id>`
- Two tiers: **Saves** (`backups/saves/*.7z`, never auto-deleted) and **Standard** (rotated per `[backup]`). **Save** on a standard row → `backup_promote_save`.
- Table/list: columns **Name**, **Date**, **Actions**
- **Delete:** inline confirmation or second step with `<input>` — placeholder `modal.backup.delete_confirm` + `` `<id>` ``; button disabled until `input === id`.
- Suggested RPC methods: `backup_list(id)`, `backup_delete(id, backup_name, confirm_id)`, `backup_promote_save(id, backup_name)`.

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

#### 8.2.6 Desktop RPC methods (UI)

**Transport (v0.1+):** React calls `desktopInvoke(method, params)` → Electron main → **stdio NDJSON** → `upriv-daemon` → `upriv-rpc` → `upriv_core`. No HTTP, no Tauri `invoke`. Errors: `{ code, message, details? }`. Shell-only: `app_exit`. See `@upriv/shared` `CORE_RPC_COMMANDS` and SDD §8.3.

In addition to §8.3:

```rust
// upriv-rpc — method names exposed to the UI (daemon + FFI)
fn vault_list(vault_root: String) -> Result<Vec<VaultRowDto>, String>;
fn vault_reorder(vault_root: String, ordered_ids: Vec<String>) -> Result<(), String>;
// Accepts full list of vault ids in new display order; rewrites [vault] order on each config.toml (atomic).
fn backup_list(vault_id: String) -> Result<Vec<BackupEntryDto>, String>;
fn backup_delete(vault_id: String, backup_name: String, confirm_id: String) -> Result<(), String>;
fn backup_promote_save(vault_id: String, backup_name: String) -> Result<(), String>;
fn vault_delete(vault_id: String, confirm_id: String) -> Result<(), String>;
fn vault_seal(vault_id: String, password: String) -> Result<(), String>;
fn log_list() -> Result<Vec<LogFileDto>, String>;           // metadata only
fn log_get(filename: String) -> Result<Option<LogFileDto>, String>; // includes content
fn log_delete(filenames: Vec<String>) -> Result<(), String>; // active current-* allowed
```

`VaultRowDto`: `{ id, display_name, persistence, storage_mode, status_color, can_seal }`.
`LogFileDto`: `{ filename, seq, isCurrent, createdAt, sizeBytes, lineCount, content? }`.

### 8.3 Desktop RPC methods (lifecycle)

```rust
fn vault_open(vault_path: String, password: String) -> Result<(), String>;
// password: Some only for `always_prompt` presence check; None = use SessionHandle / session.enc.
// Never rewrap vault.header from this value.
fn vault_close(vault_path: String, password: Option<String>) -> Result<(), String>;
fn vault_open_workspace(vault_path: String) -> Result<(), String>;  // xdg-open / explorer
fn vault_status(vault_path: String) -> Result<VaultStatusDto, String>;
```

### 8.4 CLI args

```
Upriv.exe --vault <path>
Upriv.exe --create <path>
```

**Root launcher** (demo = multi-OS stubs; **v1 production = Linux + Windows**):

| OS | File | v1 | Behavior |
|----|------|-----|----------|
| Linux | `Upriv-linux` | **Yes** | → `.upriv/app/Linux-*/Upriv --vault <root>` |
| Windows | `Upriv-windows.exe` | **Yes** | → `.upriv/app/Windows-*/Upriv.exe` |
| macOS | `Upriv-mac` | No | → `.upriv/app/macOS-arm64/Upriv.app` (v1.1+) |

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

**Packaging:** one APK contains RN UI, UniFFI bridge, `libupriv_ffi.so`, and `7zz` — not separate apps. **Rejected for mobile:** Tauri Android (experimental). **Superseded:** Flutter (see `ARCHITECTURE.md` ADR-02–04).

**Shared with desktop:** `dev/apps/shared/` (`@upriv/shared` — types, services, locale catalogs) — not the same JSX/DOM as `dev/apps/desktop/src/`.

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

### 9.5 Android — open session (no FUSE)

Same vault body as desktop: rest is `vaults/<id>/contents/`. There is **no** OS mount and **no** extract-to-workspace of ciphertext as plaintext tree.

| State | Plaintext | `contents/` |
|-------|-----------|-------------|
| CLOSED | none | present |
| OPEN | in-app file manager buffers (RAM) only | live ciphertext |
| `upriv_plain` OPEN | real `workspace/<id>/` via SAF (warned) | live ciphertext; wipe workspace on close |

**open (Android):** unlock session against `vault.header`; browse/edit via in-app file manager (or `upriv_plain` workspace). Never copy the vault into `filesDir` / OS temp to fake a mount (SECURITY-PLAINTEXT).

**close:** flush session into `contents/`; wipe `upriv_plain` workspace if used.

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
- [ ] Edit file in manager → close vault → reopen → change persisted in `contents/`
- [ ] Disconnect OTG with vault open → reconnect → recovery
- [ ] Plan B: export `.7z` → ZArchiver opens it with the vault password
- [ ] Wrong password on lock (`always_prompt`) does not change `contents/`

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
| Free disk space | `free >= size(session) + size(contents/) + 512MB` |
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
- Wrong password on lock (`always_prompt`) → `contents/` unchanged
- Orphan workspace → recovery close
- Kill during close → orphan `.new`, original vault intact
- After close with wipe on HDD → forensic recovery **does not** restore workspace files (manual test with recovery tool)

### 13.3 Manual E2E

- exFAT HD Windows ↔ Linux
- 7-Zip opens an exported portable `.7z`

---

## 14. Implementation order (for AI/dev)

**v1 scope:** Linux + Windows desktop (PRD §3.5).

1. **`upriv-core`**: config load, paths, `SevenZip` wrapper with temp dir tests.
2. **Virtual mount** (`mount/` trait + platform backends): **FUSE** (Linux) and **WinFsp** (Windows) — `workspace/<id>/` → write-through to `contents/` (`encrypted_dir` only).
2b. **`plain/` module**: extract → real `workspace/<id>/` → close from workspace + **`secure_wipe_workspace`** (no virtual mount).
3. **open/close** happy path without UI — **both** `encrypted_dir` and `upriv_plain` (Linux + Windows).
4. **Recovery** detector + discard.
5. **`7z t` gate** before write.
6. **Electron** minimal: vault list (§8.2), Lock/Unlock, config/backups modals, row click → workspace.
7. **Linux packaging**: bundle `7zz` (`Linux-x64` / `aarch64`), `Upriv-linux`, `hd-bundle` template.
8. **Windows packaging**: bundle `7zz` (`Windows-x64`), `Upriv.exe`, WinFsp runtime/deps.
9. **session.enc** + disk modes (v0.2).
10. **macOS** (v1.1).
11. **React Native Android** (`dev/apps/mobile/`): native module → `upriv-core`; SAF; workspace on HD; open/close; Intent “Open folder”; single APK.
11b. **Auto-close**: timer + FS watch per vault; warning UI.
12. **React Native iOS**: document picker + same core.

---

## 15. Recorded decisions (ADR summary)

| Decision | Choice | Reason |
|----------|--------|--------|
| Container | `.7z` AES-256 | Universality, plan B |
| vs own format v1 | No | Time, trust in 7z |
| Core language | Rust | Security, FFI, desktop daemon |
| Desktop UI | React web + Electron | Stable executables Linux/Win/Mac (x86 + ARM); AppImage validated (2026-07-03) |
| Mobile UI | React Native | Single APK/IPA; TS structure shared with desktop |
| UI security boundary | Presentation only in JS/TS | Crypto, RAM, disk, 7z in `upriv-core` only |
| v1 platform | Linux + Windows desktop | Desktop parity from day one; shared `mount/` trait (FUSE / WinFsp); portable vault format |
| Config | TOML + defaults | Readable, cross-platform |
| Password on HD | Only `session.enc` | Never plaintext |
| Vault location | `--vault` path | HD + system folder |
| Android workspace | On HD (SAF) | Desktop parity; Intent for external FM |
| Android distribution | APK in `.upriv/app/Android/` | Mandatory install; not loose “folder app” |
| Vault root | `.upriv/` groups system | UX: `workspace/` + 3 launchers at root |
| Android file editing | Intent to manager | Avoid full FM in Upriv v1 |
| Hint + note storage | `config.toml` `[vault]` | User metadata; survives seal; not sync manifest |
| Change password | Open **or** closed; current password required; re-encrypt archive + store in RAM/temp; backups unchanged | Historical snapshots keep old password by design |
| Settings UI (v1) | Subset of TOML; explicit save/discard | Hide `id`, paths, session mode, 7z tuning, wipe passes |

---

## 16. Technical references

- [7-Zip command line](https://sevenzip.osdn.jp/chm/cmdline/index.htm)
- [Electron](https://www.electronjs.org/)
- [React Native](https://reactnative.dev/)
- `ARCHITECTURE.md` in this repository (cross-platform stack, ADRs)
- PRD.md in this repository

---

*This SDD should be read together with PRD.md. Any AI or developer can start with the `upriv-core` crate and open/close integration tests.*
