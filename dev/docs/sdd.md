# SDD — Upriv

**Language:** English (UI copy: `dev/apps/shared/locales/` — see `LOCALE.md`)

> **Rest layout, storage modes, backups, and export:** [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md). `store/` at rest; lock = close; FUSE/WinFsp (desktop) or in-app file manager (mobile) while open.

> **Workspace mount:** app folder → `{place}/workspace/{display_name}/`. A vault's own folder → `{path}/{display_name}/`. Not created at init. See `.agent/AGENT.md`.

**Software Design Document**  
**Version:** 0.2  
**Date:** 2026-05-31  
**Companion:** PRD.md, `ARCHITECTURE.md`

---

## 1. Architectural overview

### 1.0 Layers (`store/` / `session` / `plain`)

| ID | Rust module | Disk | Session |
|----|-------------|------|---------|
| `store` | `upriv_core::store` | `vaults/<id>/store/` (ciphertext) | — |
| `session` | `upriv_core::session` | — | mount + RAM (`encrypted_dir`). App folder: `{place}/workspace/{display_name}/`. Own folder: `{path}/{display_name}/` |
| `plain` | `upriv_core::vault::plain` | `{parent}/{display_name}/` while open | only when `storage.mode = upriv_plain` |

Portable `.zip` / `.7z` are **export files**, not rest layout. See PRD §1.6 and SECURITY-CRYPTO.

### 1.1 Principles

0. **v1 Linux + Windows** — first delivery: desktop app on Linux and Windows (Electron + `upriv-daemon` + `upriv-core`; FUSE on Linux, WinFsp on Windows). Design the virtual-mount layer as a shared trait from day one. Mobile uses the in-app file manager (no FUSE).
1. **Vault = folder + contract** — independent of where the executable is installed.
2. **Two storage modes** — `encrypted_dir` (default) and `upriv_plain`. Rest is always `store/`. Lock = close.
3. **Core in Rust** — single `upriv-core` crate for all platforms; shared logic between desktop and mobile (FFI). UI layers (React web, React Native) are **presentation only** — no crypto, disk I/O, or session secrets in JS/TS. See `ARCHITECTURE.md` §2.
4. **Declarative config** — `.upriv/settings.toml` + per-vault `vaults/<id>/config.toml`; safe defaults if missing.
5. **Mutable config** — TOML is source of truth; the app re-reads before open/close (not “create and lock”). **Not all** fields are anytime: `[vault].display_name` / `id` only via `vault_rename` while closed; password/KDF while closed. See the mutability table in §3.2.4 and edit-policy.
6. **Fail safe** — never overwrite `store/` without verification; atomic writes. `.7z` is never kept at rest.
7. **Session keys in RAM** — unlock asks for the password once. Lock flushes with those keys. Quit or reboot asks again.
8. **Close = flush session into `store/`** — never pack `.enc` blobs into a `.7z` as rest. Export `.7z` streams **logical** content.
9. **Recovery** — dirty close → unlock the encrypted vault (`store/`). Leftover `upriv_plain` folder → recovery until the user wipes it. The leftover is not the open session. Dead header → create from backup / store zip (Backups or New vault). No archive-vs-store picker; create-from-backup is not a dirty-close peer.
10. **Unified states** — `open` (runtime) | `closed` (rest).
11. **Virtual mount** — in `encrypted_dir`, `workspace/` is not a data folder; I/O goes to encrypted `store/`.
12. **Lockfile** — one open per vault at a time.
13. **Crypto standard** — Argon2id + XChaCha20-Poly1305 in `store/`; optional `.7z` export for interoperability (weaker guessing). Do not claim “more secure than 7-Zip.”

### 1.2 High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer                                 │
│  Electron + React web (desktop)       │  React Native (mobile) │
└─────────────────────────────┬───────────────────────────────┘
                              │ RPC (upriv-daemon) / native module (RN)
┌─────────────────────────────▼───────────────────────────────┐
│                     upriv-core (Rust)                        │
│  vault │ config │ session │ paths │ mount │ store crypto  │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│  encrypted_dir (RAM/FUSE)  or  upriv_plain (workspace/)      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│  vaults/<id>/store/  +  file manager folder while open (virtual or plain) │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Vault state machine

### 2.0 Persisted states (unified — PRD §1.7)

**Central rule:** rest is **`store/`**. Persistence on disk is always **`closed`**. **`open` is runtime only.**

| `persistence` | UI (i18n) | Disk | Modes |
|---------------|-----------|------|-------|
| `open` | `vault.status.open` | session + `store/` | both (`upriv_plain`: plaintext workspace + `store/`) |
| `closed` | `vault.status.closed` | encrypted `store/` | `encrypted_dir`, `upriv_plain` |

```text
encrypted_dir / upriv_plain:
  closed ──open──► open ──close()──► closed
  # never writes a rest .7z
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
| `persistence` (after successful close) | `closed` only — also written to persistence sidecar |

`.upriv/state.json`: `vaults.<id>.session` while app runs.

**`open`:** only when `session == "open"` (lock + mount + key in RAM). Never infer `open` solely because `store/` exists on disk.

**`closed`:** header + index verification on `store/`.

### Critical transitions

**open (v1):**
1. Resolve `<vault-root>` (`UPRIV_VAULT_ROOT`, the active `.upriv-root`, or `default_root`; the Gate asks when none is found).
2. Load `vaults/<id>/config.toml`.
3. Try to acquire `runtime/<id>.lock` — failure → `error.vault_already_open`.
4. Read `header/vault.header` (or `vault.header.copy` when the primary cannot be used); derive master key (Argon2id from header params) — failure → abort.
5. Verify index / chunk tags needed for the session.
6. If dirty close: **recovery** → unlock the encrypted vault. If a leftover `upriv_plain` folder is still there: wipe it. If header/index dead: create from backup / store zip (not a dirty-close peer).
7. `encrypted_dir`: mount the file manager folder when it is on — FUSE (Linux) + WinFsp (Windows); mobile uses the in-app file manager (no FUSE).
8. `upriv_plain`: after the place is confirmed, stream `store/` into that folder. No FUSE/WinFsp.
9. Update `.upriv/state.json` → `vaults.<id>.session = "open"`.

**close (v1):**
1. Use the open session keys in RAM. Lock does not ask for the password and does not rewrap `vault.header`.
2. Flush the session into `store/` (header + index + chunks). Never pack `.enc` blobs into a `.7z` as rest.
3. If `[backup] enabled`: write a Stored zip of `store/` to `backups/<stamp>-<id>.zip` (no zip password). `skip_unchanged` (default on) skips that zip when vault files match the last backup still on disk. `.upriv-workspace.json` is not a change. Off writes a zip on every close.
4. `upriv_plain`: save the folder into `store/`, wipe the files, and remove the folder. Lock starts immediately.
5. Unmount the file manager folder; release `runtime/<id>.lock`; remove entry in `state.json`.
6. `zeroize` password/keys in RAM.

**Reopen after reboot:** `open` against `store/`; edits from the last successful close are in the ciphertext tree.

### 2.1 Session integrity on close (not a new password)

**Close flushes the open session with the open session keys.** It takes no password, and a typed password is **not** an input to wrap `vault.header`. RF-05 is header/session integrity before backup or flush.

| Situation | Behavior |
|-----------|----------|
| Encrypted vault | Lock with the open session keys; no password field |
| Open `upriv_plain` | Same flush, then wipe the folder. No password |
| Session gone (crash / process exit) | Recovery against `store/` — do not ask a close password to “finish” a dead session |
| First close of a vault created this session | Header already written at create; validate session key |

Related: PRD **RF-05**, **RF-39**; checklist §12. Close does not take a password.

### 2.2 Persistence / integrity

File: `.upriv/vaults/<id>/persistence.json` beside `config.toml` (outside `store/`).

Sync metadata: `content_hash`, `last_close_ok_at` (recovery A), and the last backup that finished (`backed_up_index_hash`, `backed_up_stamp`) for `skip_unchanged`. Canonical detail: [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md).

```json
{
  "format_version": 1,
  "vault_id": "my-encrypted-notes",
  "display_name": "My encrypted notes",
  "content_hash": "sha256:…",
  "backed_up_index_hash": "sha256:…",
  "backed_up_stamp": "20260528140000",
  "last_close_ok_at": "2026-05-28T14:00:00.000Z",
  "persistence": "closed"
}
```

(`persistence`: `closed` at rest only; `open` is **never** persisted — runtime session only.)

**Rules (`upriv-core`):**

| Condition | Action |
|-----------|--------|
| Dirty close / leftover `upriv_plain` workspace | `recovery` |
| `content_hash` differs from header + sealed index | `recovery` (same session). Unlock still opens that `store/`; close records its hash. A missing hash or a read error while hashing does not select recovery |
| Header/index unreadable | Create new vault from backup only |
| One chunk tag fail | That file; vault still opens |
| Successful close | Update `content_hash` + `last_close_ok_at` |

Related: PRD **RF-47**, **RF-48**, **RF-57**, §3.4.

### 2.3 Close action

Lock is always **close** (flush the session into `store/`).

| Action | `encrypted_dir` | `upriv_plain` |
|--------|-----------------|---------------|
| `close` | `closed` | `closed` (wipe plaintext workspace) |

Related: PRD **RF-53**, **RF-53b**.

### 2.4 Virtual mount (`workspace/`)

**v1:** mount implementation **Linux (FUSE) + Windows (WinFsp)**. DocumentProvider (Android) in later phases (PRD §3.5).

**Invariant:** in `encrypted_dir`, **never** create persistent regular files in the file manager folder on the vault volume.

**Linux mount:** the FUSE root exposes an empty `.nomedia` that is not a vault file, so Tracker does not index the tree while it is open. A real `.nomedia` in the vault is that file instead. While that folder is mounted, on `OPEN_PURGE_INTERVAL` in the thumbnail module, and again when the mount is detached, Upriv overwrites freedesktop thumbnail-cache PNGs whose `Thumb::URI` is under the mount, syncs that write, then unlinks them (one random pass, the same wipe as §2.10; flash is best-effort). Detaching a leftover Upriv mount does the same purge once, so a killed session does not keep those previews. The cache is outside `store/`. The scan starts and returns at once, with a file-count and time budget, so a bad cache cannot hold close, open, or unmount. A finished wipe of one or more previews writes one info line (`vault_thumbnail_wiped`, with the count and no path). A problem is one warning (`vault_thumbnail_purge_failed`). Neither fails the close or the unmount. A vault with no OS folder does not run this sweep.

**Windows mount.** The volume is `WinFsp.Disk` on the directory the user chose. `WinFsp.Net` cannot mount on a directory: Windows only allows a drive letter for a network file system. A disk folder would normally let Explorer build content thumbnails, so each file reports `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`. That tells the shell that reading the bytes is a fetch, and Explorer does not open the file to draw a preview. The mount refuses `Thumbs.db` in any case, and it refuses Windows device names (`CON`, `NUL`, `COM1`, and the same with an extension). `%LocalAppData%\Microsoft\Windows\Explorer\thumbcache_*.db` is not opened or deleted. Entries there are hash keys, Explorer keeps the databases open, and removing them would wipe every thumbnail on the machine. The Linux freedesktop scanner does not run on Windows, and the periodic sweep is a no-op there, so it does not log `vault_thumbnail_purge_failed` on each interval. WinFsp creates that directory and returns `STATUS_OBJECT_NAME_COLLISION` (`0xC0000035`) when the name already exists. An existing empty directory is removed first; a directory that already has files is left in place and the mount fails. A canonical `\\?\` path is passed as a plain directory, because WinFsp treats `\\?\C:` as a Mount Manager path. The Windows setup and the portable exe carry the official unmodified WinFsp installer. Upriv asks to install it when the file manager folder is turned on, and again when a vault that already wants that folder is opened. Declining leaves the switch unchanged and shows a notice with a button to try again. A missing DLL fails the mount and leaves the vault open for the in-app file manager. The folder is a directory junction (`FSCTL_SET_REPARSE_POINT`). exFAT and FAT return `STATUS_NOT_IMPLEMENTED` (`0xC0000002`), so the mount fails with `vault_mount_filesystem` and Open in file manager asks for a different folder on an NTFS or ReFS disk. The vault still opens in the in-app file manager. Ciphertext can stay on the original disk; only the file manager folder needs the other location. A WinFsp drive letter would not need the junction. That fallback is not implemented. Uninstalling Upriv leaves WinFsp installed. Case-insensitive lookup keeps the stored spelling. Explorer extra-large-icon behavior still needs a machine that has WinFsp installed; it was not confirmed here.

**macOS mount (not built yet).** Shipping that mount includes thumbnail cleanup for that OS. Do not reuse the freedesktop PNG scanner. Do not wipe a global cache. The same rules apply: only while that vault's OS folder is mounted, on `OPEN_PURGE_INTERVAL`, and once more when the folder is detached; the work returns immediately; one info line with a count and no path when something was removed; one warning when the cleanup cannot finish; close and open still succeed. One overwrite plus sync plus unlink where the cache is a normal file. Flash stays best-effort.

**macOS, when a mount exists (macFUSE or FSKit).** Finder and Quick Look store previews under the per-user Darwin cache directory, `com.apple.quicklook.ThumbnailsAgent/com.apple.QuickLook.thumbnailcache/` (`index.sqlite` plus `thumbnails.data` on current macOS). That is not one PNG per file. `qlmanage -r cache` deletes every Quick Look preview on the Mac and must not be called. From Mojave onward that cache sits in a DataVault, so another process may be unable to edit it. `.metadata_never_index` is the Spotlight analogue of `.nomedia`. It does not clear Quick Look. Finder also keeps recently shown thumbnails in memory for about two or three days; that copy is outside this wipe.

Steps for the macOS mount:

1. Add `.metadata_never_index` at the mount root the same way Linux adds a synthetic `.nomedia`: not a vault file, and a real vault file of that name wins. That only addresses Spotlight.
2. Confirm whether the mount can be kept out of Quick Look (a mount flag or a file Quick Look already skips). Confirm with a picture on the mount, icon view, and Space.
3. If previews are still written, delete only the rows and bitmap bytes for this mount's paths from `index.sqlite` and `thumbnails.data`. Overwrite those bitmap bytes before the space is reused. If the DataVault or the packed data file makes a per-path delete impossible, stop. The mount must then prevent Quick Look from reading the folder. Do not call `qlmanage -r cache`.
4. Use the same lifetime, worker, `OPEN_PURGE_INTERVAL` period, detach pass, log lines, and 30-second stuck warning as Linux. Windows does not edit `thumbcache_*.db`; its sweep is a no-op.

**iOS and Android** have no OS folder for an encrypted vault. The in-app file manager does not write these caches. Do not add a sweeper there. Android `.nomedia` matters only for files on shared storage, which this mode does not use.

**RAM:** session serves decrypted bytes from RAM; the full unlocked vault working set must fit available memory (see **`warning.encrypted_dir_ram`** and §3.2.2).

```
App / Explorer  →  file manager folder/nota.txt  (logical path)
                        ↓ FUSE / WinFsp / DocumentProvider
                   CryptoLayer::read/write
                        ↓
                   vaults/<id>/store/data/….enc   (only persistence)
```

- Read: decrypt stream → RAM → caller.
- Write: caller → encrypt stream → chunk in `store/` (**write-through**).
- `workspace/` is empty mountpoint until `open()`; after `close()`, unmounted (directory may exist empty).

**Write-through invariant (RF-49b):** each `write()` on the mount puts its encrypted chunk in `store/` before it returns; plaintext never waits in RAM for close. The sealed index that names those chunks is written on the handle's flush/`close`, on `fsync`, with any other committed change, after 64 MiB of pending writes, and at the latest about 2 s after the first pending write. Until then the sealed index still names the previous bytes, and no later write overwrites them, so a crash loses at most that batch and never a sealed file. Batching keeps a large copy from resealing the whole index on every write.

| Event | Minimum guarantee |
|-------|-------------------|
| App writes and flush/`close` on handle | Updated encrypted chunk in `store/`, named by the sealed index |
| `fsync` on file (OS/editor) | Encrypted data on disk (not only app buffer) |
| Writes, then no flush for about 2 s | Same as a flush |
| Vault close | Global flush of session into `store/` |

**Do not confuse:** read cache in RAM ≠ authoritative copy; on-disk authority is always `store/` after committed write.

**Required tests:** write via mount → no plaintext in real `workspace/` → ciphertext present in `store/` before vault close.

Related: PRD **RF-49**.

#### 2.4.1 Encrypted store — file and folder names (forensic resistance)

In `encrypted_dir`, **logical paths must not appear in plaintext** under `vaults/<id>/store/` on HD/SSD. Forensic inspection of the tree alone must not reveal what each blob represents (e.g. `passwords.txt` vs `photo.jpg`).

**On-disk layout (example):**

```text
store/
├── DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md
├── header/vault.header       # format + KDF params + wrapped key (no cleartext tree)
├── header/vault.header.copy  # same bytes; spare for a damaged primary
├── index/root.idx.enc        # encrypted directory tree (paths + metadata)
├── index/root.idx.enc.copy   # same bytes; spare for a damaged primary
└── data/<hh>/<file_id>.blob  # one ciphertext file per logical file (<hh> = first two hex digits of the id); chunk offsets live in the index
```

**Crypto (see [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md)):**

| Layer | Cipher | What it protects |
|-------|--------|------------------|
| Content blobs | `XChaCha20-Poly1305` (default) | File bytes |
| Path / name index | `AES-SIV` (`name_cipher`) | File and folder names, tree structure |

**Rules:**

- Never persist logical paths as human-readable filenames under `store/data/`.
- Index updates are write-through with content (same session key).
- Logical names are visible only in the **virtual mount** / in-app file manager while the vault is **open** (session), not as durable plaintext on the vault volume.

**Portable `.7z` export:** `[seven_zip] encrypt_file_names = true` by default — names hidden inside the export file too. Disabling it is a deliberate downgrade (UI warning). Export is not rest layout.

Related: PRD §3.3.1, **RF-45**, **RF-49**, **RF-49b**.

### 2.5 Lockfile

- Path: `.upriv/runtime/<id>.lock` (PID + hostname + timestamp).
- Acquire at start of `open()`; release on `close()` and in crash recovery (optional stale TTL).
- Second `open` on same or other PC → clear error.

Related: PRD **RF-54**.

### 2.6 `.7z` export

- Close flushes `store/`. It does not pack a `.7z`.
- Portable `.7z` export is a separate action. `upriv-core` packs it in process with `sevenz-rust2` (logical content in RAM, streamed from `store/` one chunk at a time; ciphertext only on disk). No `7zz` binary, no `-p` on a command line, no plaintext temp directory. Detail in §5.1.
- If RAM is not enough for that pack, return `InsufficientRamExport` and do not spill a decrypted tree.
- Never use the file manager folder as export staging.

Related: PRD **RF-45**, **RF-50**.

### 2.7 Swap minimization

- Decrypt/encrypt buffers and the `OpenSession` keys: `zeroize` on drop. Pages are not locked (`mlock` / `VirtualLock`), so swap and hibernation can hold them (RF-51).
- Document: **do not** guarantee total absence of swap on Windows/macOS without elevated privileges.
- Future strict mode: discourage hibernation while vault open.

Related: PRD **RF-51**.

### 2.8 Who can open the files

The file manager folder is the switch. Off keeps the open vault in Upriv. On places a folder on this computer while the vault is open, and any app that can see that path can read the files. There is no second policy for “only Upriv” on top of an open folder, and no mount-layer block on copies to Desktop, USB, or temp.

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
> **`upriv_plain`:** wipe the plaintext file manager folder on close (and before delete).

**Problem:** on HDD, `remove_file` / `rm -rf` **do not** erase bytes — only mark clusters free. On SSD, per-file wipe is best effort.

**Requirement:** before removing a plaintext `upriv_plain` workspace, overwrite + `fsync` + `unlink`.

**Algorithm (per file, order: deepest files first):**

```text
for each regular file in the file manager folder (do not follow symlinks outside):
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

Pure Rust on every OS (`vault/wipe.rs`); no `shred` process.

**Config (`vaults/<id>/config.toml` → `[security]`):**

```toml
[security]
wipe_passes = 1                # HDD: 1–3; more = slower, marginally stronger
wipe_pattern = "random"        # "random" | "zeros"
```

| Field | Default | Notes |
|-------|---------|-------|
| `wipe_passes` | `1` | 3 passes on HDD for paranoia; unnecessary in many cases |
| `wipe_pattern` | `random` | `zeros` faster, slightly weaker |

**When to run the same wipe**

| Flow | Wipe? |
|------|-------|
| Successful `close()` of `upriv_plain` | **Yes** — overwrite the folder, then remove it |
| Remove the folder (recovery D, `vault_plain_remove`) | **Yes** |
| Auto-close | Same as `close()` |
| Close fails before the folder is read back into `store/` | **No** — folder intact, session stays open |
| Interruption during wipe | Workspace may be partial; recovery on next open |

**Limits (document to user)**

| Media | Guarantee |
|-------|-----------|
| **Mechanical HDD** | Well-done wipe ≈ **unrecoverable** for common tools |
| **SSD / flash** | **No guarantee** — wear leveling / TRIM; wipe = best effort |
| Unallocated volume space | Out of scope — does not wipe entire disk |
| External copies | Not affected |

**Do not:** `rm -rf workspace` without overwriting the plaintext folder first.

Related: PRD **RF-41–RF-44**; tests §13.2 (`secure_wipe` mock verifies overwrite before unlink).

---

## 3. File layout and configuration

### 3.1 `.upriv/settings.toml` (marker + app settings)

Single file at `.upriv/settings.toml`: format version, UI, logging, app, and workspace preferences. The layout under `.upriv/` is fixed in code (§3.4).

```toml
[package]
version = 1

[ui]
locale = "en"
theme = "dark"
show_header_more_button = true
file_manager_dock_expanded = false
# file_manager_tree_split_percent = 20       # optional; explorer/editor split % (15–65), all vaults
# always_show_hidden_vaults = false          # optional; Hidden vaults section
# vault_list_allow_drag_into_group = true    # optional
# vault_list_show_drag = true                # optional
# vault_list_sort = "order"                  # optional; see table below
# vault_list_sort_direction = "asc"          # optional
# vault_list_view = "default"                # optional
# vault_list_search = ""                     # optional
# vault_list_show_create_button = true       # optional
# lifecycle_close_modal_on_submit = false    # optional; close the unlock dialog on Confirm
# lifecycle_open_file_manager_on_open = false # optional; open file manager after unlock if no other modal
# file_manager_confirm_delete = true # optional; confirm before deleting in file manager

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

**Upriv marker:** folder is `<vault-root>` if it contains `.upriv/settings.toml` with `[package] version = 1`. Any other version, or a file that does not parse, is an incomplete data folder (`vault_root_incomplete` → Repair).

**Vault-root location:** `vault_root_mode` / custom path are **not** `[app]` keys in TOML and are never written there. They are derived from the app-home `.upriv-root` file and exposed on the settings RPC wire as `app.*` fields for the UI only.

#### `[ui]` — fields and where they are saved (v1 desktop)

**On disk:** prefs are **flat keys under `[ui]`**. General UI (`locale`, `theme`, `show_header_more_button`, `file_manager_dock_expanded`, `file_manager_tree_split_percent`, `always_show_hidden_vaults`) then `vault_list_*` list prefs. **`show_header_more_button`** is the on-disk name for the header ⋮ (wire: `vault_list_show_header_more_button`).

**Wire / RPC:** flat `settings.ui.*` below (what TypeScript and the daemon exchange).

| Wire key | TOML (on disk) | Edited in System settings modal? | When persisted |
|-----|----------------|----------------------------------|----------------|
| `locale` | `[ui].locale` | Yes (Language) | Explicit **Save** in System settings |
| `theme` | `[ui].theme` | Yes (General) | Explicit **Save** in System settings |
| `vault_list_show_header_more_button` | `[ui].show_header_more_button` | Yes (General) | Explicit **Save** in System settings. Default `true`. Shows the header overflow (⋮) menu. |
| `lifecycle_close_modal_on_submit` | `[ui].lifecycle_close_modal_on_submit` | Yes (General) | Explicit **Save** in System settings. Default `false`. When `true`, the unlock password dialog closes on Confirm (progress on the row). |
| `lifecycle_open_file_manager_on_open` | `[ui].lifecycle_open_file_manager_on_open` | Yes (General) | Explicit **Save** in System settings. Default `false`. When `true`, after unlock succeeds open the in-app file manager if no other modal is open. |
| `file_manager_confirm_delete` | `[ui].file_manager_confirm_delete` | Yes (General) | Explicit **Save** in System settings. Default `true`. When `true`, deleting a file/folder in the file manager asks for confirmation. |
| `file_manager_dock_expanded` | `[ui].file_manager_dock_expanded` | **No** | When user **expands or collapses** the minimized file-manager dock (bottom-right chip list). Restored on next app launch. Default `false` (collapsed — count button only). |
| `file_manager_tree_split_percent` | `[ui].file_manager_tree_split_percent` | **No** | When user **releases** the file-manager explorer/editor resize grip. App-wide for every vault (not per-vault `.upriv-workspace.json`). Default `20`; clamped to 15–65. |
| `always_show_hidden_vaults` | `[ui].always_show_hidden_vaults` | Yes (Hidden vaults) | Explicit **Save** in System settings |
| `vault_list_show_drag` | `[ui].vault_list_show_drag` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows vertical drag grips on the vault list; off hides grips only (order/sort unchanged). |
| `vault_list_show_create_button` | `[ui].vault_list_show_create_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the new-vault (+) button. |
| `vault_list_show_search_button` | `[ui].vault_list_show_search_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the search button. A saved `vault_list_search` still filters when hidden. |
| `vault_list_show_sort_button` | `[ui].vault_list_show_sort_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the sort button. Current sort stays in effect when hidden. |
| `vault_list_show_view_button` | `[ui].vault_list_show_view_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the view button. Current view stays in effect when hidden. |
| `vault_list_show_vault_more_button` | `[ui].vault_list_show_vault_more_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the vault row overflow (⋯) menu. |
| `vault_list_show_vault_settings_button` | `[ui].vault_list_show_vault_settings_button` | Yes (Vault list) | Explicit **Save** in System settings. Default `true`. Shows the vault row settings (gear) menu. |
| `vault_list_show_group_settings_button` | `[ui].vault_list_show_group_settings_button` | Yes (Groups) | Explicit **Save** in System settings. Default `true`. Shows the group header settings gear. |
| `vault_list_allow_drag_into_group` | `[ui].vault_list_allow_drag_into_group` | Yes (Groups) | Explicit **Save** in System settings. Default `true`. Drop vault onto group to assign / onto list to ungroup. |
| `vault_list_sort`, `vault_list_sort_direction` | `[ui].vault_list_sort*` | No | When user changes sort on the vault list toolbar |
| `vault_list_view` | `[ui].vault_list_view` | No | When user toggles list view on the vault list toolbar |
| `vault_list_search` | `[ui].vault_list_search` | No | When the user types in the vault-list search box (debounced). The control expands only while focused. Filters ungrouped vault names, group names, and vaults inside groups. |

**Minimized file-manager dock:** after **Minimize** on a file-manager modal, vault chips appear in a floating dock. One control toggles between showing all chips vs. a single collapsed button with the count. That expanded/collapsed choice is written to `[ui] file_manager_dock_expanded` immediately on toggle — not exposed as a checkbox in System settings.

**File-manager explorer split:** dragging the resize grip between explorer and editor updates a live preview; on pointer-up the canonical % is written to `[ui] file_manager_tree_split_percent` (shared by all vaults). Not a System settings control — adjust by dragging in any open file manager.

#### Logs (`.upriv/logs/`)

Plain **`.log`** text. Keep Rust `logging/format.rs` and `@upriv/shared` `domain/logs/format.ts` in sync.

| State | Name | Example |
|-------|------|---------|
| Active (being written) | `current-{seq}-{created_utc}.log` | `current-000001-20260529120000.log` |
| Archived | `{seq}-{created_utc}.log` | `000001-20260529120000.log` |

- **`seq`:** file number, monotonic across the log history, six digits.
- **`created_utc`:** when that file was created (`YYYYMMDDHHmmss`, UTC).
- Only one file carries `current-`: the one being appended to.

**Rotation:** after line `entries_per_file` (at most 1000) the active file loses its `current-` prefix and the next `current-` file starts at index `0001`. After a crash the file still named `current-…` is where writing resumes.

**Line format:** `{index:04} {iso8601_utc_ms} {LEVEL} {event} key=value …` — `LEVEL` is `DEBUG`, `INFO`, `WARN`, or `ERROR`; `event` is snake_case; fields never carry passwords, vault names, or paths the UI allowlist forbids.

```text
0001 2026-05-29T12:00:00.010Z INFO  app_start          version=0.2.2-beta source=vault_root_resolve
```

**`[logging]`:**

| Key | Default | Effect |
|-----|---------|--------|
| `enabled` | `true` | `false` writes no lines and creates no `current-*` file; existing files stay |
| `level` | `"info"` | Lowest level written (`error` \| `warn` \| `info` \| `debug`); unknown values read as `info` |
| `entries_per_file` | `1000` | Lines per file before rotation (1–1000) |
| `keep_last_entries` | `10000` | About this many lines kept across archived files (`0` = no limit); the active file adds up to `entries_per_file` more |

Settings Save reconfigures the live writer (`ensure_logging_session` / `install_logging_at`). The Logs window re-reads the folder each time it opens and lists every `*.log` there; the writer only appends to a canonical `current-*` file and starts a new one when the active file is gone. RPC: `log_list` (metadata), `log_get` (one file), `log_delete`.

### 3.2 Vaults (`vaults/<vault_id>/`)

Each vault is a self-contained folder under `.upriv/vaults/<vault_id>/`:

```text
vaults/<vault_id>/              # vault_id = normalized slug (filesystem-safe)
├── config.toml                 # structural config
├── persistence.json            # closed (+ vault_id, display_name)
├── store/                   # rest — header/ + index + chunks
├── backups/                    # Stored zips of store/ (`<stamp>.zip`)
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
| `backups/<stamp>-<id>.zip` | Yes | Stored zip of `store/` |

#### 3.2.1 `display_name` validation and export/import

**Forbidden in `display_name`** (and therefore in `{display_name}.zip` / `{display_name}.7z` export names): `\ / : * ? " < > |`, ASCII controls, empty/whitespace-only, trailing space or `.`, reserved Windows stems (`CON`, `PRN`, …), length > 128. Accents and internal spaces are allowed.

**`vault_id`:** always normalized slug (§3.2 table); generated from `display_name`; max 64 chars; collision suffix `-2`, …

**Export** (save outside vault): `{display_name}.zip` (zip of encrypted `store/`) or `{display_name}.7z`, written into the folder chosen in that export option; characters a system refuses become `_` in the file name; a file already using the name is never replaced: the export takes the next free number (`{display_name} 2.zip`); **do not** change source vault `display_name`.

**Import** (external `.zip` of `store/` or `.7z` → new vault): stem → proposed `display_name`; if invalid, dialog with `sanitize_minimal(stem)` pre-fill; user confirms. Name rules: PRD RF-15b.

Example `.upriv/vaults/my-encrypted-notes/config.toml`:

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
skip_unchanged = true   # default; off writes a zip on every close. Layout file is not a change.

[security]
wipe_passes = 1                   # hidden default
wipe_pattern = "random"           # hidden default
# password_changed_at = "..."     # set by app on change-password; omit until first change

[auto_close]
enabled = true
idle_minutes = 15

[seven_zip]
encrypt_file_names = true
archive_mode = "compress_encrypt"   # compress_encrypt | encrypt_only
compression_level = 5     # ignored if archive_mode = encrypt_only
solid = false             # blocks of up to 64 MiB; true = one block
```

**`archive_mode` / `compression_level`** apply when a `.7z` is exported. **Default:** `encrypt_only` + level ignored (UI preset **none**).

**UI compression presets** (map to TOML; settings + create wizard):

| Preset | `archive_mode` | `compression_level` (LZMA2 level) |
|--------|----------------|--------------------------------|
| `none` | `encrypt_only` | `0` |
| `low` | `compress_encrypt` | `1` |
| `medium` | `compress_encrypt` | `5` |
| `high` | `compress_encrypt` | `9` |

**`storage.mode` per vault:**

```toml
[storage]
mode = "encrypted_dir"   # encrypted_dir | upriv_plain
# encrypted_dir — rest = store/; open: decrypt in RAM (FUSE / in-app FM)
# upriv_plain  — rest = store/; open: plaintext workspace; lock closes + wipe
```

**RAM capacity (`encrypted_dir`):** decrypted logical content is held in **RAM** while the vault is **open**. **`upriv-core`** must treat insufficient memory as a **hard failure** — open, edit, or close abort with a user-visible error; **never** silently spill plaintext workspace to disk in `encrypted_dir` (RF-49). UI: **`warning.encrypted_dir_ram`**, **`warning.upriv_plain`**. When RAM cannot fit the vault, split vaults or choose **`upriv_plain`**.

| Value | `sevenz-rust2` coder | Use |
|-------|----------------------|-----|
| `encrypt_only` **(default)** | AES + Copy | Encrypt only (faster) — UI preset **none** |
| `compress_encrypt` | AES + LZMA2 at `compression_level` | Compress + encrypt — UI presets **low/medium/high** |

**Discovery:** the vault list reads every `.upriv/vaults/<id>/config.toml`. No fixed list in code — a new vault is a new `vaults/<id>/` folder.

#### 3.2.2 Vault metadata: hint and note (storage decision)

User-facing metadata that is **not** sync state:

| Field | Where stored | Why |
|-------|--------------|-----|
| `order` | `config.toml` → `[vault]` | User-controlled display order in vault list; optional (non-negative integer) |
| `password_hint` | `config.toml` → `[vault]` | Static, user-editable; optional reminder at unlock |
| `note` | `config.toml` → `[vault]` | User annotation; same lifecycle as vault config |
| Password (secret) | **RAM only** (v1 `encrypted_dir`) | RF-24 — never in any vault file |
| Sync hashes, close time | `persistence.json` | Operational manifest — rewritten on close |

**Not used for hint/note:**

| Location | Reason |
|----------|--------|
| `persistence.json` | Machine sync state (hashes, timestamps) — mixed concerns; file changes every close |
| Separate `notes.toml` / `meta.json` | Unnecessary for v1 — simple short text fits TOML; one less file to discover and copy |

**Limits:**

| Field | Max length | Empty |
|-------|------------|-------|
| `order` | — (non-negative integer) | omit → sort after explicit values, then by `display_name` |
| `password_hint` | 128 chars | `""` or omit key → no hint shown |
| `note` | 10000 chars | `""` or omit key → no note |

**Create-new wizard (not import):** password + confirm password (required); optional hint and note written to `[vault]` on first `config.toml` save.

**Unlock UI:** if `password_hint` non-empty, show below password field (`unlock.password_hint_label`). Never pre-fill password.

#### 3.2.3 Change password

Available in vault settings (**Security** / password area in UI; stored fields span `[vault]` hint + `[security]` metadata). Edit-policy gate is **`vault_closed`** — vault must be **closed** (not open, opening, closing, or recovery). User **always** enters the **current password** (never inferred from session alone).

**Why closed-only:** an open session must not race the header rewrite. Recovery is out of this flow (same as `action.change_password` / `change_kdf` in `edit-policy.json`). File blobs stay. The master key stays. See SECURITY-CRYPTO.

| Step | Action |
|------|--------|
| 1 | User enters **current password**, **new password**, **confirm new password** (new ≠ current; bytes exactly as typed) |
| 2 | UI shows **`warning.password_change_backups`** — existing `backups/<stamp>-<id>.zip` keep the password from when each snapshot was created |
| 3 | **`upriv-core`:** vault closed; verify the current password (same 5/60s unlock throttle as open). Same password is rejected |
| 4 | Write one backup zip of the current body **before** any header byte changes. If that zip fails, leave `store/` unchanged |
| 5 | New salt, same master key. Reseal the header wrap and the name index (both bind salt/`m`/`t`/`p`). Do not rewrite file blobs |
| 6 | Commit order: new index copy, new header primary, new header copy, new index primary. A crash in the middle still opens with one of the two passwords |
| 7 | Update `persistence` content hash. Set `[security] password_changed_at` (ISO 8601 UTC, millisecond precision) |
| 8 | After the header commit succeeds, apply this vault's backup retention to standard zips. Disabled backups and `keep_all` do not delete zips. Pins under `backups/saves/` stay. A failed commit leaves the previous zips and the safety zip. Do not mark this safety zip as the close-backup stamp |

**Config after change:**

```toml
[security]
password_changed_at = "2026-05-30T18:00:00Z"   # omitted or empty until first change
```

Backups opened via Plan B or Upriv backups modal still require the **password active when that backup was taken**. Document in vault settings and backups modal footer.

**Desktop and mobile UI:** password area — `warning.password_change_backups`, `modal.settings.change_password_help`. Submit calls `vault_change_password`. Unlock RAM calls `vault_change_kdf` (same backup and commit; the password stays; `password_changed_at` is not updated).

Related: PRD **RF-58**, **RF-59**; i18n `vault.change_password.*`, `warning.password_change_backups`.

#### 3.2.3a Vault settings UI — field visibility (v1 desktop)

Settings modal edits `config.toml` but **does not mirror every key** — advanced or system-owned values stay in TOML with defaults.

| TOML section | Shown in UI | Hidden in UI (defaults / system) |
|--------------|-------------|----------------------------------|
| `[vault]` | `display_name`, `order`, `note`, `password_hint` | `id` (folder slug; derived/normalized on rename migration). Layout dirs `store/` and `backups/` are not TOML keys. |
| `[storage]` | `mode` (`encrypted_dir` / `upriv_plain`) + contextual warnings | — |
| `[auto_close]` | **Preferences / Auto-close:** close after idle time inside Upriv | — |
| `[security]` | — | `wipe_passes`, `wipe_pattern`, `password_changed_at` (set by app). Plaintext close always overwrites the open folder. |
| Password / Unlock RAM | Settings **areas** (not TOML sections): change password; change Argon2id preset | Cost lives in `store/header/vault.header`, never a `[kdf]` section |
| `[seven_zip]` | compression preset (**none/low/medium/high** → `archive_mode` + `compression_level`), `encrypt_file_names` | `solid` (default `false`) |

**Lock:** session keys stay in RAM while the vault is open. Lock flushes with those keys.

**Storage mode warnings (UI):**

| `storage.mode` | Warning key | When shown |
|----------------|-------------|------------|
| `encrypted_dir` | `warning.encrypted_dir_ram` | Storage section (settings + create wizard); Help → Security |
| `upriv_plain` | `warning.upriv_plain` | Storage section; badge **Insecure**; plaintext while open |

Related: PRD **RF-UI-17**, §1.6.

**Modal UX (unlike note/backups modals):** explicit **Save** (enabled only when dirty) → confirm save; close with dirty draft → **discard all and close** confirm; backdrop/Esc while confirm open cancels close attempt.

Related: PRD **RF-UI-04**, **RF-UI-15**.

#### 3.2.4 Mutable config (design requirement)

Configuration **is not immutable** after vault creation. User can change `[seven_zip]`, `[backup]`, `[auto_close]`, `[security]` in `vaults/<id>/config.toml`, and `[ui]` in `.upriv/settings.toml`, **anytime** — via UI or by editing TOML.

**Reading and saving:** each operation loads the TOML it needs from disk; there is no config cache. A save is an atomic write (temp + rename). `settings.toml` ignores keys and sections it does not define, except under `[workspace]`: an unknown key there makes the file unreadable (`vault_root_incomplete`). A save writes only the keys it defines. A vault `config.toml` with a key it does not define fails to load (`vault_config_invalid`) and stays as it is on disk.

**When changes take effect**

| Field / section | Vault closed | Vault open |
|-----------------|--------------|------------|
| `[seven_zip]` (`archive_mode`, levels) | Next `.7z` export | Next `.7z` export (export needs the vault closed) |
| `[backup]` | Next close | Next close |
| `[auto_close]` | Next open | Next settings read while open (about 15 s). The current idle clock is kept |
| `[security]` (`wipe_passes`, `wipe_pattern`, …) | Next **close** / discard | Wipe on close |
| `[vault] password_hint`, `[vault] note`, `[vault] order` | Immediate (UI / list) | Immediate |
| `[security] password_changed_at` | Set when change-password succeeds (**vault closed**) | **Blocked** — close vault first (`vault_closed`) |
| `[vault] display_name` | Only via **`vault_rename`** (updates the label; folder/`id` migration when the slug changes) | **Block** — close vault first |
| `[vault] id` | Only via **`vault_rename`** (folder + `config.toml` + groups/`last_opened` remap) | **Block** — close vault first |
| `.upriv/settings.toml` `[package]` | Fixed layout; not user-editable | Same |

**Forbidden**

- Assume config read only at vault creation.
- Eternal cache without checking TOML `mtime`.
- Rename `id` with a session present without a migration wizard.
- Change `[vault].id` or `[vault].display_name` through `vault_config_save` — use **`vault_rename`** (UI preferences save calls it when `display_name` is dirty).

**UI (v1+):** “Vault settings” screen edits same TOML (not parallel JSON structure that diverges).

**Name uniqueness and consistency (required):**

| Rule | Validation |
|------|------------|
| Unique `id` | The wizard picks a free slug (`displayNameToVaultId`: `-2`, `-3`, …); core refuses an existing `vaults/<id>/` (`vault_already_exists`) |
| Folder = `id` | `vaults/foo/config.toml` requires `[vault] id = "foo"`, or the vault fails to load (`vault_config_invalid`) |
| Charset | `[a-z0-9-]`, 1–64 characters, no leading or trailing `-`, not a Windows device name (`slug_id_is_valid`) |

**Files per vault:**

| Path | Use |
|------|-----|
| `vaults/<id>/store/` | Vault body at rest |
| `vaults/<id>/backups/<stamp>-<id>.zip` | Stored zip of `store/` (`[backup]`) |

**Open workspaces:** the file manager folder exists only while open; `.upriv/state.json` lists open vaults (several at once).

#### 3.2.5 Auto-close on inactivity

**Per-vault** configuration in `[auto_close]`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable automatic close |
| `idle_minutes` | u32 | `15` | Idle time until close. The app uses 1..=1440. A save writes that range |

Sixty seconds before the lock, the app shows one notice. That lead is fixed; it is not a vault setting. A 1-minute idle warns 30 seconds before, so the notice is not shown on every action. Several vaults that reach the notice together share one toast. A notice waits while another idle toast is still on screen.

The clock is the device time since the last action inside Upriv. It lives in the app process, not in `.upriv/state.json` and not in the daemon. There is no separate idle detector.

**What resets the clock:** pointer, key, and scroll on the desktop; touch and typing on the phone. One action resets every open vault that is not already due.

**What does not reset:** focus, opening the app, returning from another app, and edits in the mounted folder.

**Sleep and time away.** General setting `lifecycle_keep_open_on_wake` (default off). Off: that time counts, and a vault can already be auto-closed when the user comes back. On: only time the process is actually running counts. Desktop sleep is `powerMonitor` suspend/resume. The phone treats leaving the app as a pause. A vault that was already due while Upriv was on screen still closes. Killing the process is a dirty close, not an auto-close.

**When the deadline is reached:** wait for an import or a pipeline job already running for that vault. Save unsaved editor drafts, then run the same close as a manual lock (`reason=auto` on `vault_closed`). No dialog. A failure restarts that vault's clock only. After a successful auto-close the row says Auto-closed until the vault is opened again or locked by hand.

### 3.3 Path resolution

```rust
struct VaultRoot {
    root: PathBuf,  // absolute, canonicalized
}

impl VaultRoot {
    fn vault_dir(&self, vault_id: &str) -> PathBuf {
        self.vaults_dir().join(vault_id)
    }
    fn vault_store_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("store")
    }
    fn vault_backups_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("backups")
    }
    fn vault_config_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("config.toml")
    }
}
```

**Rule:** paths under `.upriv/` come from code (§3.4), never from TOML. The only paths in `settings.toml` and `config.toml` are folders the user chose, stored absolute. Use `std::path` — never concatenate strings with `\`.

### 3.4 Fixed layout

```rust
const SETTINGS_REL: &str = ".upriv/settings.toml";
const VAULTS_DIR_REL: &str = ".upriv/vaults";
const STATE_FILE_REL: &str = ".upriv/state.json";
const LOGS_DIR_REL: &str = ".upriv/logs";
const RUNTIME_DIR_REL: &str = ".upriv/runtime";
```

`.upriv/` without a readable `settings.toml` is an incomplete data folder (`vault_root_incomplete`): the Gate offers Repair.

---

## 4. `upriv-core` module (Rust)

### 4.1 Crates

| Crate | Use |
|-------|-----|
| `serde`, `serde_json`, `toml` | Config and RPC payloads |
| `zeroize` | Clear keys and passwords in memory |
| `argon2`, `hkdf`, `sha2` | Argon2id unlock, key derivation, digests |
| `chacha20poly1305`, `aes-siv`, `rand` | Store AEAD (pinned in `dev/vendor/`) |
| `thiserror` | `UprivError` |
| `zip`, `sevenz-rust2` | Store zip / backups, portable `.7z` |
| `uuid`, `base64`, `unicode-normalization` | File ids, wire bytes, names |

### 4.2 Modules

```
upriv-core/src/
├── config/          # settings.toml, vaults/*/config.toml, vault groups, edit policy
├── logging/         # Logger / log_event → `.upriv/logs/`
├── vault/           # list, create, open/close, fs, export, import, backup, rename, rewrap
│   ├── plain/       # upriv_plain folder open/close + wipe
│   └── seven_zip*   # in-process .7z via sevenz-rust2
├── session/         # open session keys in RAM, unlock throttle
├── store/           # header, index, chunks
├── paths/           # VaultRoot, vault-root discovery, workspace paths
├── mount/           # FUSE host (Linux), WinFsp (Windows)
├── runtime_state.rs # .upriv/state.json open records (dirty-close recovery)
└── host_fs.rs       # filesystem access, incl. Android storage-access trees
```

### 4.3 Public interface (Rust)

Free functions over a `VaultRoot`, re-exported from `upriv_core::` — for example `list_vaults(&root)`, `create_vault(…)`, `open_vault(&root, id, password)`, `close_vault(&root, id)`, `fs_*`, `export_store_zip_to_path(…)`, `import_from_backup(…)`, `change_vault_password(…)`. An open vault is an `OpenSession` (master, content, and index keys plus the decrypted index) held in `session/` until close.

Exposed to desktop via `upriv-daemon` stdio JSON-RPC and to mobile via the `upriv-ffi` UniFFI library; both call the same `upriv-rpc` handlers. See `ARCHITECTURE.md` §2.3.

---

## 5. Portable `.7z` (`sevenz-rust2` in `upriv-core`)

### 5.1 In process

- Pack and unpack with the `sevenz-rust2` crate inside `upriv-core`. Do not bundle or spawn `7zz`.
- Close does not create a `.7z`. Export is a separate action.
- Export streams: a worker thread decrypts the files from `store/` in archive order, one 256 KiB chunk at a time, into a queue of eight chunks that the encoder reads. Plaintext in RAM does not grow with the size of a file. The archive reaches its file through a 1 MiB buffer.
- Files are grouped into 7z blocks. A block closes before the file that would take it past 64 MiB, so a larger file gets a block of its own; with several LZMA2 workers a block also holds at least one chunk (the LZMA2 window) per worker. `solid = true` puts every file in one block. Each block, and the encrypted header, gets its own random AES salt and IV. 7-Zip derives the AES key (2^19 SHA-256 rounds) once per block.
- The RAM check runs before the vault is decrypted: the decrypt queue, the write buffer, the archive header (a fixed part per member plus its name), and the coder. A copy-only archive has no coder cost. One LZMA2 worker streams with one encoder (window, match finder, coder state, as `lzma-rust2` 0.16 allocates them). Several workers each keep an encoder and share a queue that takes a whole block of plaintext ahead of them, so the largest block counts twice. LZMA2 gets as many workers as fit in free RAM (at most 8), and one when no more fit; export fails with `InsufficientRamExport` when even one does not.
- Export progress counts the logical bytes the encoder has taken (`job_status`).
- Members are decoded in RAM and written into `store/` through the logical file API. The archive file is read through a 1 MiB buffer. Never extract a decrypted tree under `workspace/` or OS temp.
- One outer folder (sanitized display name). Vault files sit directly under it, including a user `config.toml`. No settings sidecar. The seed file and `.upriv-workspace.json` are skipped.
- The same import option examines a `.zip`. `store/header/vault.header` is the store-zip copy (`README.md` and `config.toml` sit beside `store/` and are not copied into the new vault). Any other `.zip` streams ordinary documents into a new `store/`. A symlink inside a `.zip` or a folder is not stored and not followed. A symlink chosen as the source path is refused. The rest of the import continues. Files are sealed in waves, so a crash keeps the last finished wave in `store/`.

### 5.2 What not to run

Do not shell out to 7-Zip. These commands are not the implementation (they put the password on `argv` and extract plaintext onto disk):

| Do not run | Why |
|---|---|
| `7zz t -p{pass}` | Password appears in the process list |
| `7zz x -p{pass} -o{workspace}` | Writes a decrypted tree on disk |
| `7zz a -p{pass} … <file manager folder>/*` | Reads a decrypted tree and puts the password on `argv` |

### 5.3 Password

- The archive password stays in process memory and is passed to `sevenz-rust2`. It is not an argument of a child process.
- `sevenz-rust2` keeps its own copy of the password for each block, and `sevenz-rust2` and `lzma-rust2` keep their own working buffers of plaintext. The crates free them without a wipe. Upriv's decrypted chunks are wiped when the encoder has read them.
- A wrong password fails the probe before a new vault is kept.

### 5.4 Parameters

`[seven_zip]` in `vaults/<id>/config.toml`, used by the next `.7z` export:

| Field | Default | Set by |
|-------|---------|--------|
| `encrypt_file_names` | `true` | Vault settings and the Export window |
| `archive_mode` | **`encrypt_only`** | Compression preset (`none` = `encrypt_only`) |
| `compression_level` | `0` (`low` / `medium` / `high` = 1 / 5 / 9 with `compress_encrypt`) | Compression preset |
| `solid` | `false` (blocks of up to 64 MiB) | Not shown; `true` = one block |

---

## 6. Session

### 6.1 `OpenSession` (RAM)

`session::OpenSession` holds the vault's master, content, and index keys and the decrypted index while the vault is open. It derives `Zeroize`, and the keys are cleared when the session is dropped at close.

### 6.2 Close

Lock flushes the open session with the keys already in RAM.

| | open | close | reboot |
|--|------|-------|--------|
| session | ask for the password; keep session keys in RAM | use those keys; no prompt | keys are gone; ask again |

The password string stays in the app after a successful unlock, until lock or quit. It is not written to settings or to disk.

---

## 7. Recovery

### 7.1 Detection

`list_vaults` lists a closed vault as `recovery` when:

| Case | Detected by |
|------|-------------|
| Dirty close (A) | `.upriv/state.json` records the session as open and no live process holds `runtime/<id>.lock` (`dirty_close_ids`) |
| Leftover `upriv_plain` folder (D) | `state.json` records a plaintext folder this computer can reach that was never wiped |
| Different `store/` (A) | `persistence.json` `content_hash` differs from the header + sealed index on disk. A missing hash or a read error is not a mismatch |

One bad chunk (B) fails that file when it is read; the vault still opens. An unreadable header or index (C) is not recovery: the vault does not open, and a new vault comes from a backup.

### 7.2 Actions

| Action | Effect |
|--------|--------|
| Unlock (A) | Opens the `store/` on disk with the password; the next close records its hash and clears recovery |
| Remove the folder (D, `vault_plain_remove`) | Wipe the leftover plaintext folder after the user confirms and leave the vault closed; `store/` stays as last saved. Unlock refuses until then (`plain_leftover`) |
| Create from backup (C) | Unpack `backups/<stamp>-<id>.zip` into a **new** vault — never overwrite the source |

### 7.3 Reopen after crash (no RAM session, `store/` still on disk)

**Typical case:** app quit, crash, or reboot — `state.json` is empty (`vaults: {}`), but `vaults/<id>/store/` still holds the last flushed ciphertext (and recovery may need dirty-close / leftover `upriv_plain` workspace handling).

```text
vaults/<id>/store/ exists
state.json has no active session (not in RAM)
        │
        ▼
User Unlock → password
        │
        ▼
Validate header + index (§2.2)
        │
        ├─ dirty close / leftover workspace → recovery UI first
        └─ OK → mount the file manager folder (session in RAM only)
                    │
                    ▼
              User works / chooses Close
                    │
                    ▼
              action.close → flush session into store/
              persistence: closed
```

**Rules:**

- Do **not** require re-importing from a portable `.7z` if `store/` is intact and checks pass.
- Password is required to derive keys and mount — nothing sensitive is restored from `state.json` alone.
- **Close** flushes the session into `store/` and leaves the vault closed.
- Portable `.zip` / `.7z` export remains a separate user action, not rest layout.

**Dead header/index:** create a **new** vault from a backup stamp or store zip.

Reference: [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md).


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

**i18n:** load `dev/apps/shared/locales/{locale}.json` per `[ui] locale` in `.upriv/settings.toml`. No hardcoded UI sentences in Rust/TS — see `LOCALE.md`.

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

**Brand — wordmark color variants** (`dev/docs/brand/`; PNG rasterized from matching SVG):

| Variant | Hex | Files | Use |
|---------|-----|-------|-----|
| White | `#FFFFFF` | `Upriv-wordmark-white.svg`, `Upriv-wordmark-white.png` | Dark UI, splash, default header on `#0f172a` |
| Black | `#000000` | `Upriv-wordmark-black.svg`, `Upriv-wordmark-black.png` | Light backgrounds, print |
| Navy | `#0B0E1E` | `Upriv-wordmark-navy.svg`, `Upriv-wordmark-navy.png` | Brand wordmark on light/neutral surfaces |

Default in-app header: **white** variant. App icon tile background: `#0f172a` (see `Upriv.svg` / `Upriv-icon.svg`). Brand sources: `dev/docs/brand/`; desktop UI copies: `dev/apps/desktop/assets/`.

**Row interaction**

```text
click(row) && !click(button):
  if session == open      → open the in-app file manager for this vault
  else                    → Unlock (same as the Unlock button)

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
| **Closing** | Row badge + modal (if open) + finite budget | During flush into `store/` |
| **Opening** | Row badge + unlock dialog (while open) + finite budget | During Argon2 unlock |

**Open/close pipelines (v1):** one global **FIFO queue** — only one open/close/create runs at a time; further requests wait. Progress lives on the **row** (and the unlock dialog while it is open; lock opens no dialog); there is **no** blocking full-screen pipeline overlay and no **Continue in background**. Queued vaults show `opening` / `closing` / `creating` until their turn completes. No mid-pipeline cancel (abort would risk inconsistent disk state). Desktop/mobile UI implements the FIFO queue in `useVaultPipelineRun`; live open/close call `vault_open` / `vault_close`. While a closed vault is exporting, changing its password, or changing unlock RAM, the row names that work and `vault_open` is refused until it finishes. That same hold refuses a data-folder switch. Close already shows Backing up… while its backup zip is written.

**Pipeline — errors and stuck states:**

| Area | Behavior | Notes |
|------|----------|-------|
| **FIFO queue** | `useVaultPipelineRun` queues jobs; the list shows `opening` / `closing` / `creating` | Daemon RPC `vault_open` / `vault_close` / `vault_create` |
| **User-facing errors** | i18n toast; `revertCloseFailure` on a failed close | Rust codes mirrored in `VAULT_ERROR_CODES` |
| **No cancel mid-flush** | PRD RF-UI-10 | Aborting a flush would risk an inconsistent store |
| **IPC timeout** | `LOADING_BUDGET_MS.vaultPipeline` / `vaultCreate` (10 min) | Same values as `CORE_RPC_TIMEOUT_MS` |
| **State after a failure** | A failed close keeps the session open | `store/` is unchanged |
| **Queue after an error** | `failureMode: "advance"` starts the next job | No slot stays taken |

No separate Welcome screen in v1; on first run the Gate asks for the data folder.

#### 8.2.3 Modal — backups

- Title: `modal.backup.title` — `<id>`
- Two tiers: **Saves** (`backups/saves/<stamp>-<id>.zip`, never auto-deleted) and **Standard** (`backups/<stamp>-<id>.zip`, rotated per `[backup]`). **Save** on a standard row → `backup_promote_save`.
- Table/list: columns **Name**, **Date**, **Actions**
- **Delete:** inline confirmation with `<input>` — prompt `modal.backup.delete_confirm`; phrase = the vault's **current** display name, a space, and the count (`Notes 2`), even when backup file names carry an older id; button disabled until the trimmed input matches.
- Suggested RPC methods: `backup_list(id)`, `backup_delete(id, backup_name, confirm_id)`, `backup_promote_save(id, backup_name)`.

#### 8.2.4 Modal — vault settings

- Form generated from the `vaults/<id>/config.toml` schema (collapsible sections).
- **`[vault]` section** includes **`order`** (integer) — same semantics as list sort; user may set position manually when not using drag-and-drop.
- **Save (preferences):** if `display_name` changed vs baseline → **`vault_rename`** first (folder/`[vault].id` migration when the slug changes; remaps groups + `last_opened` + leftover closed mount leaf). List/modal identity updates immediately after a successful rename, even if a later `vault_config_save` of other prefs fails. Other dirty preference fields → **`vault_config_save`** against the **effective** id.
- Footer **`modal.settings.danger_zone`:** **`modal.settings.delete_vault`** button (red) → confirmation with `input === id` → `vault_delete(id, confirm_id)`.

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

**Transport:** React calls `desktopInvoke(method, params)` → Electron main → **stdio NDJSON** → `upriv-daemon` → `upriv-rpc` → `upriv_core`. No HTTP. Errors: `{ code, message, details? }`. Electron main answers the shell-only methods itself. See §8.3. **Daemon concurrency:** `vault_open` / `vault_create` (Argon2) run on a worker thread so light RPCs (settings, groups, list, close, …) are not blocked on stdin; still **one Argon2 at a time** (worker + core `UNLOCK_GATE`). Responses may complete out of order — Electron matches by request `id`.

`AppLogFile`: `{ filename, seq, isCurrent, createdAt, sizeBytes, lineCount, lineCountExact, content }` (`log_list` leaves `content` empty; `log_get` fills it).

### 8.3 RPC methods

`@upriv/shared` names every method: `CORE_RPC_COMMANDS` (desktop and mobile), `MOBILE_ONLY_RPC_COMMANDS`, and `SHELL_ONLY_RPC_COMMANDS` (Electron main). `rpc-methods.json` lists the same names, and tests hold it equal to `upriv-rpc` and to the Electron allowlist. `CORE_RPC_TIMEOUT_MS` gives each one its deadline.

| Area | Methods |
|------|---------|
| App | `app_version`, `app_settings_get`, `app_settings_save` |
| Data folder | `vault_root_resolve`, `vault_root_setup_default_root`, `vault_root_setup_path`, `vault_root_deactivate_alias`, `vault_root_read_alias`, `vault_root_default_root_status`, `vault_root_inspect_path`, `vault_root_suggested_custom_path`, `data_folder_export` |
| Logs | `log_list`, `log_get`, `log_delete`, `log_event` |
| Groups | `vault_group_list`, `vault_group_create`, `vault_group_update`, `vault_group_delete`, `vault_group_set_collapsed`, `vault_group_reorder`, `vault_group_reorder_grouped_vaults`, `vault_group_repair` |
| Vaults | `vault_list`, `vault_create`, `vault_config_get`, `vault_config_save`, `vault_rename`, `vault_delete`, `vault_store_size`, `vault_change_password`, `vault_change_kdf` |
| Open / close | `vault_open`, `vault_close`, `vault_close_phase`, `vault_plain_confirm`, `vault_plain_destination`, `vault_plain_leftover`, `vault_plain_remove`, `vault_plain_sync`, `vault_plain_status`, `vault_plain_deletions` |
| File manager | `vault_fs_list`, `vault_fs_revision`, `vault_fs_read`, `vault_fs_read_range`, `vault_fs_write`, `vault_fs_write_range`, `vault_fs_import_os_file`, `vault_fs_import_seal`, `vault_fs_truncate`, `vault_fs_create_file`, `vault_fs_create_folder`, `vault_fs_ensure_folder`, `vault_fs_delete`, `vault_fs_rename`, `vault_fs_move`, `vault_fs_os_path` |
| Export / import | `vault_export`, `vault_export_capabilities`, `vault_export_probe`, `vault_import_zip`, `vault_import_7z`, `vault_import_files_zip`, `vault_import_os_path`, `vault_import_probe` |
| Backups | `backup_list`, `backup_get`, `backup_save`, `backup_delete`, `backup_promote` |
| Jobs | `job_status`, `job_cancel` |
| Mobile only | `app_settings_parse_toml`, `vault_root_remember_custom`, `vault_ingest_open`, `vault_ingest_directory`, `vault_discard_import` |
| Electron main | `app_exit`, `pick_directory`, `pick_file`, `pick_save_file`, `reveal_in_file_manager`, `reveal_os_path`, `open_in_terminal`, `winfsp_status`, `winfsp_install`, `fuse_status`, `fuse_install`; main sends `app_shutdown` to the daemon itself |

**Vault export.** `vault_export` takes the folder chosen in the export option (`destDir`) and writes `{display_name}.zip` or `.7z` there (`vault_export_file_stem`). It never replaces a file, or a partial one, already using that name: it takes the next free number (`{display_name} 2.zip`, `{display_name} 3.zip`, …, also when a file arrives under the name while it writes) and logs `vault_export_numbered` (`format`, `id`, `number`; no name or path). It refuses a folder inside a `.upriv` (`export_destination_reserved`). The answer is the written `path` and `size`; the UI names a numbered file in its toast (`vaultExportSavedAs`).

**Jobs.** `vault_export`, `backup_save`, and `data_folder_export` each carry a `job` id the UI makes with `newJobId`. `job_status` reports the bytes that job has done; `job_cancel` stops it, and a stop for a job still waiting for its lane is kept, so it ends as soon as it starts. A stopped job fails with `job_cancelled` and leaves no file: the export's `.upriv-part`, the save's `.partial`, or the data folder's `.zip.upriv-part` is removed. When the UI gives up on one of these, by its budget or by the call's own `rpc_timeout` (whichever comes first), it sends `job_cancel` for it, so core does not keep holding the vault. `app_shutdown` stops every running job, and any that starts after it. The log records each stop (`job_cancel` with `by=user|timeout`, `jobs_stopped_on_quit`), how the job ended (`vault_export_cancelled|failed`, `vault_backup_save_cancelled|failed`, `data_folder_export_cancelled|failed`, with the failure reason and no path), and the removal of its unfinished file (`partial_removed`, or `partial_remove_failed` when the file stays).

### 8.4 Launch

No command-line argument picks the data folder. `UPRIV_VAULT_ROOT` overrides the resolved folder for the whole process (§ vault-root discovery in `.agent/AGENT.md`). Electron's `--dev` loads the Vite renderer; the portable AppImage and exe keep their app home beside the downloaded file.

---

## 9. Mobile

### 9.1 Stack (Android v2 / iOS v3)

| Layer | Technology |
|-------|------------|
| UI | React Native + TypeScript |
| Bridge | Expo module `upriv-core` → UniFFI Kotlin (JNA) → `libupriv_ffi.so` on Android; iOS later |
| Core | `upriv-core` (same crate as desktop; compiled per target) |
| 7z | `sevenz-rust2` inside `upriv-core` (no `7zz` binary in the APK/IPA) |

**Packaging:** one APK contains RN UI, UniFFI bridge, and `libupriv_ffi.so` — not separate apps. **Rejected for mobile:** Tauri Android (experimental) and Flutter (see `ARCHITECTURE.md` ADR-02–04).

**Shared with desktop:** `dev/apps/shared/` (`@upriv/shared` — types, services, locale catalogs) — not the same JSX/DOM as `dev/apps/desktop/src/`.

### 9.2 Android — overview

Android **does not** run HD binaries like desktop. Model is:

1. **APK** distributed in `app/Android/Upriv.apk` (HD bundle) or outside → user **installs** once.
2. Installed app **binds** vault via **SAF** (persistent URI of HD root folder).
3. Vault layout **identical** to desktop: `.upriv/…` + `workspace/` at HD root.
4. File editing is the **in-app file manager** (RAM only for `encrypted_dir`). **Open in system files** is an extra action, not the editor.

**Decision (ADR):** `workspace/` folder stays **on vault volume (OTG)**, not internal-only cache, for desktop parity and folder Intents.

### 9.3 Android — installation and HD package

| Item | Behavior |
|------|----------|
| `.upriv/app/Android/Upriv.apk` | Installation artifact; tap opens Package Installer |
| Folder with “extracted” APK on HD | **Not supported** — Android does not run app as loose `dex`/`lib` folder on OTG |
| After install | APK on HD optional; app lives in system launcher |
| `.7z` | Packed in process by `upriv-core`. The app does not extract `7zz` into cache |

### 9.4 Android — SAF and vault identification

**First run (bind vault):**

```text
Upriv (installed)
  → data-folder setup
  → app folder, or ACTION_OPEN_DOCUMENT_TREE
  → takePersistableUriPermission(uri, READ|WRITE)
  → Rust addresses that folder as /upriv-saf-root
  → app-home alias .upriv-root stores that logical path, not the content:// URI
```

**Discovery:** vaults live under the chosen data folder's `.upriv/vaults/`. Do not use absolute path `/storage/XXXX-XXXX/...` as source of truth. Do not store the `content://` URI in `settings.toml`.

**Abstraction in `upriv-core`:** `host_fs`. Desktop paths use `std::fs`. A picked Android folder is a `content://` tree. Rust addresses it as `/upriv-saf-root`. `host_fs` sends that prefix to the mounted `SafFs` bridge, which opens documents on the grant and returns detached file descriptors. The logical path is not created on disk. Do not copy a vault into `filesDir` or OS temp to fake a mount.

**Writes on the bridge:** every rewrite of an existing file (settings, configs, `state.json`, persistence) is a temp file, `fsync`, then rename onto the name — the live file is never truncated in place. DocumentsContract cannot rename onto an existing name, so `SafFs` renames the old document to `<name>.<unix-ms>.replacing`, renames the temp onto `<name>`, then deletes the aside copy. If the drive is pulled between those renames, the next lookup of `<name>` renames the newest aside copy back. Directory `fsync` is not available through the bridge.

**Unplugged drive:** a removed volume answers every lookup as a miss. When an operation misses and the tree's own root document no longer answers, `SafFs` reports `unavailable`. `host_fs` maps that to `NotConnected` with a bridge-only marker, and RPC returns `vault_root_unreachable` (not `vault_root_not_found`). `mountSafRoot` throws `saf_unreachable` before probing. The grant, the active-URI pref, and `.upriv-root` are kept: settings load from `.upriv-root` (custom_root, not on disk). The Gate opens Setup with Custom still selected, shows the error in that screen and in a toast above it, and keeps the grant. Opening the app again with the drive connected continues straight in while that Custom choice is unchanged. Switching to the Documents default keeps that custom grant on the `custom=` line of `.upriv-root` and still shows the folder on the Custom option. If checking that folder finds the volume gone, inspect reports `unreachable` (the reconnect copy, not a writable-location failure) and Retry tries again. A later vault list while that grant is unmounted returns `vault_root_unreachable`, not `vault_root_not_found`. Choosing a different custom folder replaces `custom=` and releases the previous custom grant.

**Export folders:** Export data folder and the vault export write straight into a folder the user picks with `ACTION_OPEN_DOCUMENT_TREE`. `mountSafExport` binds `SafExportFs` (the same bridge as `SafFs`, without the Documents → `Upriv` step) and Rust addresses that tree as `/upriv-saf-export`, beside the data folder mount. `host_fs` keeps the two trees apart: a rename between them is refused. Core refuses a picked tree whose address has a `.upriv` segment. One mobile adapter (`SafExportMount`) serves both exports, one at a time: it keeps the tree mounted until `job_status` reports that export's job ended, so a timed-out call still lets core remove its `.upriv-part`, then unmounts it. Each field that keeps a picked folder (Export a copy, the vault `.zip`, the vault `.7z`) holds its grant (`ExportFolderGrants`, never the data folder's), so the folder stays for the next export, also after its window closes. The grant is released once no field holds that folder (another pick replaced it, or the vault list went away) and no export is writing there. An export folder that stops answering fails the export as `io_error`; only the data folder answers `vault_root_unreachable`.

**Who reports `unreachable`:** only Android inspect, when the persistable grant is held and the volume does not answer. The shared disk status and the reconnect copy are not Android-only. iOS security-scoped bookmarks (§9.11) return the same inspect status when the bookmark is still valid and the volume is gone. Do not add a second status. Desktop location, Repair, and Recovery already show that copy if inspect returns `unreachable`. Desktop Rust inspect does not return it. A missing filesystem path is not found. Resolve treats that as an invalid alias, and the Gate opens alias recovery. A deleted folder looks the same, so desktop must not map every missing path to `unreachable`.

### 9.5 Android — open session (no FUSE)

Same vault body as desktop: rest is `vaults/<id>/store/`. There is **no** OS mount and **no** extract-to-workspace of ciphertext as plaintext tree.

| State | Plaintext | `store/` |
|-------|-----------|-------------|
| CLOSED | none | present |
| OPEN | in-app file manager buffers (RAM) only | live ciphertext |
| `upriv_plain` OPEN | real file manager folder via SAF (warned) | live ciphertext; wipe that folder on close |

**open (Android):** unlock session against `vault.header`; browse/edit via in-app file manager (or `upriv_plain` workspace). Never copy the vault into `filesDir` / OS temp to fake a mount (SECURITY-PLAINTEXT).

**In-app file manager context menu (mobile vs desktop):** row ⋯ on mobile / right-click on desktop share the same actions (new file/folder, rename, copy path, open in system files, delete last in red) except **Open in terminal** — **desktop only**. Phones have no useful “open folder in terminal” target; keep the action off the React Native menu. Open in system files and Open in terminal show only when the vault has a real OS folder: when the file manager opens it calls `vault_fs_os_path` on `/`, and a `vault_mount_failed` there or on a later click hides both items. That covers mount disabled, mount failed, and mobile without a mount.

**Explorer selection / dirty cues (desktop + mobile):** the active editor file stays highlighted in the tree with a soft square on-surface wash (~6%, weaker than hover); hover uses `surface-container-highest`. Unsaved editable drafts show a small white dot after the file name (tabs and explorer). Session icon colors (RAM-only): **created** this session (create/import) → `vault-status-open` (green); **modified** (save/rename/move/dirty of an existing path) → accent. Folders inherit from descendants with **created outranking modified** (VS Code-style). A created file that is later edited stays green.

**Explorer move (desktop + mobile):** drag a file/folder onto a folder (or empty explorer area → root) to move it. Desktop uses HTML5 DnD; mobile uses long-press (~450ms) then pan. Reject self/descendant targets. Same `movePath` + session remap as rename.

**Unsaved drafts (VS Code-style):** switching tabs / opening another file keeps dirty drafts in RAM and does **not** prompt. Prompt only when **closing a dirty tab** or **dismissing the file-manager workspace** with any dirty files.

**Explorer → editor:** single-click (desktop) / tap (mobile) a file in the tree opens or activates it in the editor (adds a tab if needed, expands ancestor folders, scrolls the tab into view) — same as VS Code reveal.

**Markdown notes (desktop + mobile):** a new file is created as `.md`. A row under the tabs shows the open file's path as breadcrumbs that always start with the vault name (for example `Personal › notes › bank.md`). Each name truncates on its own; when the row is too narrow, earlier crumbs give up width first so the file name stays readable. On `.md` tabs that row also holds a Code | Read control (Code on the left) and, to its right, an outline button. The outline button shows or hides a sidebar on the right of the note, in both views. It lists the note's top-level headings (not those inside quotes, lists or footnotes) in order, each indented under the nearest shallower heading above it. Clicking an entry scrolls Read to that heading, or puts the Code cursor on its line (mobile Code: focus + caret, the OS scrolls it into view). Notes over the preview size cap show no headings. A note the parser cannot read is shown as source in Read, and the outline says it could not be read. Open/closed is per vault (`markdownOutlineOpen`). The choice is one vault-wide `markdownView` (`preview` = Read, `source` = Code) on `.upriv-workspace.json`. Missing and invalid values load as `preview`. Read draws the current draft (CommonMark plus GFM tables, strikethrough, task lists, autolinks, and footnotes) and does not accept typing. A task checkbox toggles its own `[ ]` / `[x]` in the draft, which marks the file unsaved like an edit in Code; read-only notes keep the checkboxes disabled. Inline code and fenced blocks copy on a second click (desktop) or tap (mobile) on the same value within `MARKDOWN_COPY_DOUBLE_TAP_MS` (500 ms, longer than the explorer's 300 ms double-tap), or with one press on their copy control. Images are not loaded — the alt text is shown. A link opens only when clicked, and only for `http`, `https`, and `mailto`. Raw HTML is shown as text. Code is the existing editor.

**Open-tab reorder (desktop + mobile):** drag a tab onto another tab to change strip order (`openTabs`). Desktop: HTML5 DnD. Mobile: long-press (~450ms) then pan. Order is part of `.upriv-workspace.json` persistence. Does not change the active file unless the user also activates a tab.

**Workspace layout persistence (`.upriv-workspace.json`):** logical file at the vault root (encrypted with the vault body in `store/`). Hidden from the in-app explorer/editor (reserved name; create/rename/delete/move/open blocked). **Source of truth = vault tree**, not the JSON — on load, drop tabs/folders/selection that no longer exist; corrupt/unknown `format_version` → start clean. Host mounts FM with `key={vaultId}` so vault switches remount persistence cleanly. Explorer/editor **split %** is **not** per-vault — it lives in app `[ui].file_manager_tree_split_percent` (default 20, clamp 15–65), shared by every vault; dragging the FM grip patches settings on pointer-up (same pattern as dock expand).

| Persist (vault `.upriv-workspace.json`) | Persist (app `settings.toml` `[ui]`) | Do not persist |
|---------|----------------|----------------|
| `openTabs` (+ order), `activeTabPath`, `expandedPaths`, `selectedPath`, `markdownView` (`preview` or `source`; missing → `preview`), `explorerCollapsed` (missing or not `true` → shown), `markdownOutlineOpen` (missing or not `true` → hidden) | `file_manager_tree_split_percent` | Unsaved drafts, dirty dots, session created/modified cues, modal UI |

**Hide explorer (desktop + mobile):** the explorer header starts with one button: a sidebar icon plus the "Explorer" label. It hides the explorer and its resize grip with no leftover strip; the icon alone moves to the start of the tab bar, and pressing it shows the explorer again. As the header narrows, the label truncates with an ellipsis; once only the icon is left, the four actions (new file, new folder, import files, import folder) wrap to a second row. On desktop, the explorer's right-click menu (empty area / root) also has **Hide explorer**. Per vault (`explorerCollapsed`), because each vault keeps its own layout. Rename and new file/folder type the name in the explorer row, so they show a hidden explorer. The split % is unchanged while hidden.

**When to write (product):** on each layout action (open/close/reorder tab, expand folder, selection, markdown Read/Code, hide/show explorer, show/hide outline) while the FM is open — skip write if the sanitized snapshot is unchanged. Also flush on FM dismiss, unmount (minimize), and vault close/purge. Split writes to app settings on drag end. Does **not** write on every editor keystroke (drafts are not persisted here).

**When to restore:** when the user **opens the file manager** for that vault (not auto-open on unlock). The shell paints immediately from memory. Hydration reads `.upriv-workspace.json` after paint and applies it only while memory is still the cold-open layout, so an edit made before that read wins. Tabs, folders, focus, the markdown Read/Code choice, whether the explorer is hidden, and whether the outline is open come back as last saved for that vault; split comes from app settings.

**Current stage:** layout persistence is live on `store/` via `vault_fs_*` (hidden reserved file; missing/corrupt → start clean). FUSE and the in-app explorer omit `.upriv-workspace.json` and the seed file. Portable `.7z` skips `.upriv-workspace.json` and the seed file; a `.zip` of `store/` keeps the ciphertext as-is.

**close:** flush session into `store/`; wipe `upriv_plain` workspace if used.

### 9.6 Android — Open in file manager (Intent)

PRD requirement **RF-A05**. `RevealInFileManager.kt` hands the system Files app a location the user already sees — the data folder, an import file, `store/` ciphertext, or an `upriv_plain` folder: a `content://` URI, or `/upriv-saf-root/…` turned into a document URI on the grant, opened through an `ACTION_VIEW` chooser. An encrypted vault has no plaintext folder to open.

The in-app explorer (copy, move, rename, delete) is the editor on Android. Opening the system file manager does not replace it.

### 9.7 Android — screens (v1)

| # | Screen | Actions |
|---|--------|---------|
| 1 | Welcome | Select vault / Last vault |
| 2 | Unlock | Password |
| 3 | Open | In-app file manager; **Close vault** |
| 4 | Recovery | Unlock encrypted vault. A leftover plaintext folder shows a warning, then **Remove the folder** wipes it |
| 5 | Closing | Progress while `store/` flushes |

### 9.8 Android — app config (outside vault)

The persistable grant is held by Android. Rust addresses the chosen folder as `/upriv-saf-root`. The app-home alias `.upriv-root` stores that logical path. A `custom=` line in the same file is the last Custom folder (`content://`). `settings.toml` does not store the grant. SharedPreferences keep only `active_uri` (the folder mounted now). Switching to Documents/Upriv keeps `custom=` and that grant. Choosing a different custom folder replaces the line and releases the previous grant.

**Do not** store password. Optional: `last_opened_vault = "vault-example-1"`.

### 9.9 Android — recovery and OTG

| Event | Detection | Action |
|-------|-----------|--------|
| Drive unplugged (app running or at launch) | `vault_root_unreachable` (see §9.4) | Gate opens Setup with Custom still selected. Reopen with the drive connected continues when that choice is unchanged. The grant stays. |
| Drive pulled during a replace | `<name>.<unix-ms>.replacing` beside a missing `<name>` | Next lookup restores the newest aside copy |
| `settings.toml` empty or unparseable | `.upriv/` is incomplete | Repair; default **Reset settings, keep vaults** writes a fresh `settings.toml` and keeps `vaults/`, backups, groups, logs. Rename / delete stay available |
| Empty `state.json` | Torn write | Read as no open sessions; dirty close still uses lock files |
| App killed with a vault open | `state.json` open record + stale lock | Recovery (dirty close) on next list |

### 9.10 Android — manual E2E tests

- [ ] Install APK from HD (OTG) → bind vault → open/close
- [ ] “Open folder” button opens manager at `workspace/` (≥2 apps)
- [ ] Edit file in manager → close vault → reopen → change persisted in `store/`
- [ ] Disconnect OTG with vault open → reconnect → recovery
- [ ] Data folder on OTG → unplug → restart app → Setup with Custom still selected → reconnect → reopen opens the same folder when that choice was not changed
- [ ] Switch that data folder to the Documents default → Custom still shows the previous folder → unplug that drive → select Custom → Retry → plug it back → Retry opens it
- [ ] Plan B: export `.7z` → ZArchiver opens it with the vault password

### 9.11 iOS (later phase, summary)

- Same vault layout on HD/cloud visible to Files.
- App **only** via App Store / TestFlight — **no** `app/iOS` binary on HD.
- Folder access via **UIDocumentPicker** / security-scoped bookmarks (analogous to SAF).
- A held bookmark whose volume is gone uses the same inspect status `unreachable` and reconnect copy as Android (§9.4). A revoked bookmark is `unauthorized`. Do not add an iOS-only status.
- Workspace on accessible volume when permission allows; Intent/limitations differ from Android.

---

## 10. App home (outside the data folder)

The app home holds one file, `.upriv-root`: the data folder path chosen with "another folder" (`custom_root` mode). It is also where `default_root` creates `.upriv/`.

| Launch | App home |
|--------|----------|
| `npm run electron:dev` | `dev/` (`UPRIV_DEFAULT_ROOT_ANCHOR`) |
| AppImage / portable exe | Beside the downloaded file |
| Installed, Linux | `$XDG_DATA_HOME/upriv` or `~/.local/share/upriv` |
| Installed, Windows | `%LOCALAPPDATA%\Upriv` |
| Installed, macOS | `~/Library/Application Support/Upriv` |

Content:

```text
status=active
/media/user/HD/my-vault
```

`status=inactive` keeps the path while `default_root` is in use. The file is written only after the user picks another folder. **Do not** store a password here.

---

## 11. Limits and validation

| Rule | Suggested value |
|------|-----------------|
| Workspace size before close | warn if > 3 GB |
| Free disk space | `free >= size(session) + size(store/) + 512MB` |
| Workspace name | block `..`, dangerous symlinks on extract |
| One default vault | v1; multiple in v1.1 |

---

## 12. Security — implementation checklist

- [ ] Close verifies the session and `vault.header` before backup or flush; the index is written atomically (temp + rename, primary and `.copy`)
- [ ] `zeroize` password and session keys
- [ ] Logs without password or full sensitive paths
- [ ] Do not follow symlinks when wiping a plaintext folder
- [ ] Overwrite the plaintext folder before removing it
- [ ] `fsync` after each file overwrite (HDD)
- [ ] Recovery **Remove the folder** uses the same wipe

---

## 13. Tests

### 13.1 Unit (Rust)

- Parse config + defaults
- Relative path resolution
- State machine transitions (mock seven_zip)

### 13.2 Integration

- Create vault temp dir → open → touch file → close → reopen
- Close without a password → `store/` holds the open session
- Orphan workspace → recovery close
- Kill during close → orphan `.new`, original vault intact
- After close with wipe on HDD → forensic recovery **does not** restore workspace files (manual test with recovery tool)

### 13.3 Manual E2E

- exFAT HD Windows ↔ Linux
- 7-Zip opens an exported portable `.7z`

---

## 14. Build status (for AI/dev)

**v1 scope:** Linux + Windows desktop (PRD §3.5).

**Built:**

- **`upriv-core`**: config, paths, `store/` crypto, in-process `.7z` (no plaintext temp).
- **Virtual mount**: **FUSE** (Linux) and **WinFsp** (Windows) — the file manager folder writes through to `store/` (`encrypted_dir` only).
- **`vault::plain`**: real file manager folder while open; close reads that folder and overwrites it before removal (no virtual mount).
- **open/close** for both `encrypted_dir` and `upriv_plain` (Linux + Windows); unlock checks the password with Argon2id before any write.
- **Recovery**: dirty close and leftover `upriv_plain` folder.
- **Electron** UI: vault list (§8.2), Lock/Unlock, settings/backups modals, in-app file manager.
- **Packaging**: AppImage + `.deb` (Linux), NSIS + portable `.exe` with the WinFsp installer (Windows). No `7zz` binary.
- **React Native Android** (`dev/apps/mobile/`): UniFFI bridge → `upriv-core`; storage-access data folder; open/close; in-app file manager; single APK.
- **Auto-close**: idle time inside Upriv per vault, with a warning toast.

**Remaining:** macOS mount (v1.1), React Native iOS (document picker + same core).

---

## 15. Recorded decisions (ADR summary)

| Decision | Choice | Reason |
|----------|--------|--------|
| Rest format | `store/` (Argon2id + HKDF + XChaCha20-Poly1305, AES-SIV names); `.zip` of `store/` or `.7z` only as export | Offline guessing pays Argon2id; per-file chunks; `.7z` stays the portable plan B |
| Core language | Rust | Security, FFI, desktop daemon |
| Desktop UI | React web + Electron | Stable executables Linux/Win/Mac (x86 + ARM); AppImage validated (2026-07-03) |
| Mobile UI | React Native | Single APK/IPA; TS structure shared with desktop |
| UI security boundary | Presentation only in JS/TS | Crypto, RAM, disk, 7z in `upriv-core` only |
| v1 platform | Linux + Windows desktop | Desktop parity from day one; shared `mount/` trait (FUSE / WinFsp); portable vault format |
| Config | TOML + defaults | Readable, cross-platform |
| Password on HD | Never | Session keys stay in RAM |
| Data folder | `default_root` beside the app, or a chosen folder (`.upriv-root` in the app home); `UPRIV_VAULT_ROOT` overrides | Portable first; HD or system folder |
| Android data folder | Storage-access grant on Documents/Upriv | Survives uninstall; no broad storage permission |
| Android distribution | APK in `.upriv/app/Android/` | Mandatory install; not loose “folder app” |
| Portable mode | Portable `.exe` (Windows) and AppImage (Linux): no install, data folder beside the file; a read-only folder falls back to user data; macOS is installed only | One file for users who do not want to install (PRD §3.5.1) |
| Vault root | `.upriv/` groups system | UX: at the root only the portable app files, `workspace/` while a folder is open there, and `.upriv/` |
| Mobile file editing | In-app file manager | No FUSE on Android; plaintext stays in RAM |
| Hint + note storage | `config.toml` `[vault]` | User metadata; readable without unlock; not sync manifest |
| Change password | Closed vault only; current password required; backup zip first; same master key; header and name index resealed; file blobs stay | Snapshots keep the password from when they were written |
| Settings UI (v1) | Subset of TOML; explicit save/discard | Hide `id`, paths, 7z tuning, wipe passes |

---

## 16. Technical references

- [`sevenz-rust2`](https://crates.io/crates/sevenz-rust2) (in-process `.7z` export/import)
- [Electron](https://www.electronjs.org/)
- [React Native](https://reactnative.dev/)
- `ARCHITECTURE.md` in this repository (cross-platform stack, ADRs)
- `prd.md` in this repository

---

*This SDD should be read together with `prd.md`. Any AI or developer can start with the `upriv-core` crate and open/close integration tests.*
