# PRD — Upriv

**Language:** English (UI copy: `dev/apps/shared/locales/` — see `LOCALE.md`)

> **Rest layout, storage modes, backups, and export:** [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md). Two modes (`encrypted_dir`, `upriv_plain`); rest = `store/`; lock = close; export is an action (`.zip` of `store/` or `.7z`).

**Product Requirements Document**  
**Version:** 0.2  
**Date:** 2026-05-31  
**Status:** Draft for implementation kickoff  
**Companion:** `sdd.md`, `ARCHITECTURE.md`

---

## 1. Product vision

### 1.1 What it is

Upriv is a **portable vault manager**. At rest the vault body is **`store/`** (Argon2id → HKDF → XChaCha20-Poly1305 chunks, AES-SIV names). **Lock = close** (flush the session into `store/`). Portable files are a **separate export action**: recommended ordinary **`.zip` of `store/`** (zip is an envelope, no zip password), **`.7z`** (logical Plan B), or a **plain-text `.zip`** (not encrypted, so a person with the password can always take their data out). Canonical protocol: [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md).

**v1 (initial goal):** both storage modes on **Linux and Windows desktop** (Electron + `upriv-daemon` + `upriv-core`): default **`encrypted_dir`** (FUSE on Linux, WinFsp on Windows; decrypt in RAM) and exception **`upriv_plain`** (real plaintext `workspace/` on disk while open, UI warning + wipe on close). macOS and mobile follow the same layout (in-app file manager on mobile — no FUSE).

The user opens with a password, edits via a virtual mount / in-app file manager (or plaintext `workspace/` in `upriv_plain`), ciphertext stays in `.upriv/vaults/<vault_id>/store/`, and close writes the session back into `store/`. Export (when the user asks) writes `{display_name}.zip` or `{display_name}.7z` **outside** the vault directory — never a durable twin beside `store/`.

Differentiators vs. manual 7-Zip use:

- Guided flow: **Open vault → Work → Close vault**
- **Standardized** vault-oriented layout (`.upriv/settings.toml`, `vaults/<vault_id>/` per vault)
- Works on **external HD, local system folder, or synced cloud** (as long as the vault is a folder)
- **Plan B:** export a `.7z` that opens in 7-Zip / ZArchiver (weaker offline guessing than `store/`; honest copy — not “more secure than 7-Zip”)
- Recovery after dirty close (unlock the encrypted vault). A leftover `upriv_plain` folder stays until the user removes it

### 1.2 Problem it solves

| Problem | Upriv solution |
|----------|-----------------|
| LUKS / BitLocker don't open on all devices | Portable `store/` + optional `.7z` export |
| Cryptomator: proprietary format; paid mobile | Open protocol in `store/`; Android later |
| Manual 7-Zip: easy to forget to recompress; plaintext folder on HD | Encrypted `store/` + virtual workspace; `.7z` only on export |
| Passwords/sensitive files on exFAT without encryption | One vault folder with Argon2id + AEAD at rest |
| Multiple PCs / HD / local folder | Same vault layout anywhere |

### 1.3 Target audience

- Technical or semi-technical users who store **passwords, documents, keys, exports** (not focused on huge videos/VMs).
- Wants **one place** (HD or folder) with strong encryption and access on **Windows, Linux, Mac** (Android/iOS in later phases).
- Values **export to ordinary zip / 7-Zip** and ease of use.

### 1.4 Non-goals (v1)

- **Non-desktop clients** as the first shipping target — layout stays portable.
- Replace cloud password manager (Bitwarden, etc.) — can **store** exports inside the vault.
- Full-partition encryption (LUKS/VeraCrypt).
- A custom “Upriv file” type — the recommended portable file is an ordinary `.zip` of ciphertext.
- A durable `.7z` copy of `store/` at rest.
- Replace full-disk encryption at OS/firmware level.

### 1.6 Storage modes (shipping)

**Two modes.**

| Mode | ID | When to use | Close behavior | v1 UI |
|------|-----|-------------|----------------|-------|
| **Encrypted directory (default)** | `encrypted_dir` | Normal use. Rest = `store/`. While open: decrypt in RAM (FUSE/WinFsp; in-app file manager on mobile). | Lock = close → flush session into `store/` → `closed` | **Yes** |
| **Plaintext folder while open** | `upriv_plain` | Large vaults / when RAM cannot hold the working set. Rest = `store/`. While open: real plaintext `workspace/`. UI badge **Not recommended**: while open, anyone or any app that can read the folder reads the files, and system copies can outlast the wipe. | Lock = close → write `store/` → wipe workspace → `closed` | **Yes** |

**`encrypted_dir` RAM:** decrypted content is served through the virtual mount / session buffers. Open, edit, or close may **fail** if RAM is insufficient — never silently spill plaintext to ordinary disk. UI: `warning.encrypted_dir_ram`. Prefer **`upriv_plain`**, smaller vaults, or more RAM when hardware cannot meet this limit.

The user chooses the mode in `vaults/<id>/config.toml` (`[storage] mode`). UI warnings: `warning.encrypted_dir_ram`, `warning.upriv_plain`.

`[storage] plain_files` says what a plaintext folder holds: `chosen` (default, **Only files I choose**) or `whole`. It is a choice inside `upriv_plain`, not a third mode.

**Helper (shared domain):** `storageModeIsPlaintext` = `upriv_plain`. Both modes keep `store/` at rest and both can export.

### 1.7 Vault states

**Rule:** on disk, persistence is always **`closed`** (`store/` present). **`open` is runtime only.**

| State (ID) | UI (i18n) | What exists |
|-------------|---------|----------------|
| **`open`** | `vault.status.open` | Session + mount (or plaintext `workspace/` for `upriv_plain`) + `store/` |
| **`closed`** | `vault.status.closed` | `store/` at rest; no session |

```text
encrypted_dir / upriv_plain:
  closed ──open──► open ──close──► closed
  # upriv_plain open: plaintext workspace (wipe on close)
```

- Implementation transients: `closing`, `opening`, `recovery` (not resting UI states).
- **`open`:** active lock + mount (or plaintext workspace) + session key in RAM. Folders on disk are **not** sufficient.
- **`closed`:** `store/` + `persistence.json` `closed` + no active session.
- **Recovery:** dirty close → unlock the encrypted vault. A leftover `upriv_plain` folder is not adopted as the open session: recovery wipes that folder. Dead header/index → create a **new** vault from backup (do not dual-pick archive vs store).

**Detection on startup (per vault):**

| Situation | Result |
|----------|-----------|
| Active lock + mount | `open` |
| Dirty close / leftover plaintext workspace | **`recovery`** |
| `store/` + manifest `closed` | `closed` |
| Dead header/index | recovery → create from backup only |

### 1.9 v1 flows (both modes)

#### `encrypted_dir` (default)

| Step | What |
|-------|--------|
| 1 | **Open:** unlock `store/` (`vault.header`); decrypt in RAM. |
| 2 | **Session:** mount the file manager folder when it is on (desktop) or use the in-app file manager (mobile). No durable plaintext tree on ordinary disk. |
| 3 | **Edit:** each save updates the session **and** persists ciphertext chunks in `store/`. |
| 4 | **Close:** flush session into `store/`; optional backup = Stored zip of `store/` at `backups/<stamp>-<id>.zip` (no zip password). |
| 5 | **Close:** unmount, zero password/keys in RAM → **`closed`**. |

#### `upriv_plain` (plaintext while open)

| Step | What |
|-------|--------|
| 1 | **Open:** with `plain_files = "chosen"` the folder already chosen starts empty, so opening takes about as long as RAM mode. With `"whole"`, stream `store/` into it. No FUSE/WinFsp, even when the file manager folder is on. |
| 2 | **Edit:** what is in the folder is the working copy of those files. `store/` stays the source of truth, and the in-app file manager reads, edits, deletes, and finds every file, sent or not. Outside edits are saved after the folder is quiet, on a two-minute pass, and on close. Deleting a sent file from the folder deletes it from the vault for good, with no extra step. **Remove from folder** wipes the folder's copy and keeps the file. |
| 3 | **Lock:** the same triggers as RAM mode. Lock starts the close immediately. A clean wipe removes the folder. |

**Accepted trade-off (v1):** after reboot, the user **must re-enter the password** to open again. Data in `store/` is not lost. Crash while `upriv_plain` is **open** leaves plaintext on disk until close/wipe.

**Export (separate action):** user chooses `.zip` of `store/` (Recommended), portable `.7z`, or a plain-text `.zip` (Insecure). **This vault must be closed** (other vaults may stay open). File zip/7z import and create-from-backup copy a frozen tree; they do not require the source vault closed. `.7z` never stores `.enc` blobs; zip envelope has **no** zip password.

### 1.8 Technical mitigations (architecture)

| # | Risk | Product mitigation |
|---|--------|----------------------|
| 1 | Incomplete close | Recovery: unlock the encrypted vault again (`resume_store`). A leftover plaintext folder is wiped. Create-from-backup is for a dead store (row 2), not a dirty-close peer |
| 2 | Dead `vault.header` / index | New vault from a `backups/<stamp>-<id>.zip` — not a dual store/`.7z` picker |
| 3 | Direct writes to `workspace/` on HD (`encrypted_dir`) | **Virtual** mount (FUSE/WinFsp) or in-app FM; tests that forbid persistent plaintext |
| 4 | Plaintext temp when exporting `.7z` | Pack in process with `sevenz-rust2`; never stage a decrypted tree |
| 5 | Swap/hibernation | **Minimize** swap of sensitive buffers (`mlock`, RAM buffers); do not promise 100% on all OSes |
| 6 | External apps (Word, etc.) | The file manager folder is the switch. Off keeps the files in Upriv. On is a folder on this computer, and apps that can see that path can read the files |
| 7 | Encrypted traces on SSD | Ciphertext in `store/` / `backups/`; `upriv_plain` wipe is best-effort on flash |
| 8 | Two PCs on same HD | `runtime/<id>.lock` + warning; simultaneous use remains user responsibility |
| 9 | `upriv_plain` mode | Strong UI warning; wipe on close (documented SSD limits) |
| 10 | Custom crypto | Standard primitives (Argon2id + AEAD); universality/portability via **`.7z`** |
| 11 | Old backups | UI: list/export/delete; **create new vault from backup** (no in-place restore) |

**Store encryption:** use the most mature and auditable libraries and formats possible (do not reinvent AEAD/KDF). Plan B and backups remain in **7z**.

---

## 2. Main use cases

### UC-0 — Create new vault (from scratch, not import)

1. User clicks **`app.new_vault`** on the vault list screen.
2. Enters **`display_name`** (validated per RF-15b).
3. Enters **password** and **confirm password** (required; must match).
4. Optionally enters a **password hint** (reminder only — not the password).
5. Optionally enters a short **vault note** (simple annotation for the user).
6. App creates `vaults/<vault_id>/` layout, writes `config.toml` (including hint/note if provided), and initializes `store/`.
7. Vault opens (or appears in the list as `closed`).

**Import path (RF-15e) is different:** external `.7z` → new vault uses the archive’s existing password to validate; no new password wizard unless the user chooses **change password** later.

### UC-1 — Portable on an external HD (no install)

1. User copies the portable app to the HD root: `Upriv-<version>-portable-x64.exe` (Windows) and/or `Upriv-<version>-linux-<arch>.AppImage` (Linux) (§3.5.1).
2. Runs it from the HD. The first run creates `.upriv/` beside the file; later runs, on this or another computer, open the same one.
3. Enters password → the vault opens in the in-app file manager, and in the file manager folder when that is on → edits files. On Windows an exFAT or FAT drive cannot hold the file manager folder (`vault_mount_filesystem`); the in-app file manager still works, or the folder goes on an NTFS disk.
4. **Close vault** → the session is flushed into `store/` and the file manager folder goes away; only ciphertext persists. `.zip` / `.7z` export is a separate action.

### UC-2 — Installed app, or a data folder elsewhere

1. App installed (`.deb`, Windows setup) — the data folder is the user-data folder — or portable anywhere.
2. **⋯ → Data folder** → choose another folder: one that already holds `.upriv/settings.toml` opens as-is; an empty one gets a new `.upriv/`.
3. Same open/close flow.

### UC-3 — Recovery after crash

1. Data folder reachable; `.upriv/state.json` still records an open session (or a plaintext folder), but no running app holds the vault's lock.
2. The vault list shows that vault in **recovery**.
3. Encrypted vault: the user unlocks with the password and gets `store/` as last saved. Plaintext vault: **Remove the folder** wipes the leftover folder; then unlock.

### UC-4 — Plan B without Upriv

1. User **exports** `{display_name}.zip` (Recommended — ciphertext envelope) or `{display_name}.7z` (logical Plan B). Neither file lives in the vault at rest.
2. Opens the `.7z` with 7-Zip / ZArchiver + password (documented in `README.md` at vault root if needed). The zip lists opaque ciphertext; only Upriv decrypts it.

### UC-5 — Vault on Android (OTG HD)

1. **First time on phone:** user installs Upriv from `.upriv/app/Android/Upriv.apk` (on HD) or another source; opens app from Android launcher.
2. **Link the data folder:** setup opens the system screen on Documents; the user confirms once and Upriv creates `Documents/Upriv` inside that grant — or the user picks another folder (an OTG HD included). The grant persists.
3. **Open vault:** enter password → the vault opens in the **in-app file manager**; in `encrypted_dir` decrypted files stay in RAM. `upriv_plain` writes its plaintext folder at the chosen place.
4. **Work:** edit in the in-app file manager. **Open in file manager** hands a folder to the system Files app when there is one on disk.
5. **Close vault:** in Upriv → flush the session into `store/`; `upriv_plain` also wipes and removes its plaintext folder.
6. **Next times:** open installed app; use already authorized vault URI (no need to reinstall APK if app stays installed).

**Android v1 non-goal:** run app "unpacked" from HD folder (without installation).

---

## 3. Functional requirements

### 3.1 Vault lifecycle

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-01 | Create new vault (`vaults/<vault_id>/` layout + `.upriv/settings.toml` + `store/`) | P0 |
| RF-01b | **Create-new wizard (not import):** require password + confirm password; optional **password hint** field | P0 |
| RF-01c | **Vault note:** optional user annotation per vault (max 10 000 characters); editable in create wizard and vault settings | P1 |
| RF-01d | Store `password_hint` and `note` in **`config.toml` `[vault]`** — not in `persistence.json`, not a separate notes file (v1) | P0 |
| RF-02 | Open vault (`encrypted_dir` default): validate password, mount the file manager folder when it is on, load encrypted store | P0 |
| RF-03 | Expose `workspace` to user (button `action.open_folder` → OS file manager) | P0 |
| RF-04 | Close vault (`encrypted_dir`): unmount the file manager folder, flush session into `store/` using **session keys** (not a newly typed password), clear session keys. Default lock has **no password prompt** | P0 |
| RF-04h | `upriv_plain` mode: rest = `store/`; while open plaintext `workspace/`; UI **`warning.upriv_plain`** + badge **not recommended**; lock always **close** + wipe workspace → `closed`. Lock starts immediately and does not ask for the password | P1 |
| RF-04c | (`encrypted_dir`) Require sufficient RAM for the **entire unlocked vault** while open; fail open/edit/close with user-visible error if not; UI **`warning.encrypted_dir_ram`** (RF-UI-17) | P0 |
| RF-05 | On close: verify **open session / `vault.header`** before backup or flush — failure aborts; `store/` unchanged. Flush uses the open session keys. Lock does not ask for the password and does not rewrap the header | P0 |
| RF-06 | Atomic write of `store/` (header + index + chunks); `.7z` is never kept at rest | P0 |
| RF-07 | Backup on close: Stored zip of `store/` at `backups/<stamp>-<id>.zip` if `[backup] enabled` (no zip password). `skip_unchanged` (default on) skips the zip when vault files match the last backup still on disk; file-manager layout is not a change | P1 |
| RF-07b | Modes: `keep_last` (only latest backup) or `keep_all` (history) | P1 |
| RF-08 | Recovery UI if workspace/marker exists with vault logically "closed" | P0 |
| RF-09 | Open an existing data folder: the default folder beside the app, or one chosen in the Gate | P0 |
| RF-10 | Remember the chosen data folder in the app home (`.upriv-data-folder`) and the last opened vault in `settings.toml` `[app]` | P2 |
| RF-11 | **Multiple vaults** per HD: one `vaults/<id>/` folder per vault (`config.toml` + encrypted `store/`) | P1 |
| RF-12 | File manager folder while open. App folder: `{place}/workspace/{display_name}/`. Vault's own folder: `{path}/{display_name}/`. Not created at init. See `.agent/AGENT.md`. | P0 |
| RF-13 | Discover vaults by listing `.upriv/vaults/<id>/config.toml` | P0 |
| RF-14 | Open/close vaults **independently** (several open at once) | P1 |
| RF-15 | **Unique `vault_id`:** normalized slug for `vaults/<vault_id>/`; `display_name` for UI / export file name / `workspace/` | P0 |
| RF-15b | **Validate `display_name`:** reject `\ / : * ? " < > \|`, controls, empty, trailing space/`.`, reserved Windows stems, length > 128; allow Unicode accents and spaces | P0 |
| RF-15c | **`vault_id` slug:** normalize from `display_name` (lowercase, spaces→`-`, strip forbidden, optional accent fold); max 64 chars; collision suffix | P0 |
| RF-15d | **Export:** each option (`.zip` of encrypted `store/`, `.7z`, or plain-text `.zip`) has its own folder field, chosen before Export and kept for the session; the file is `{display_name}.zip` / `{display_name}.7z` in that folder, with characters a system refuses replaced in the file name only; a file already using that name is never replaced: the export gets the next free number (`{display_name} 2.zip`) and the toast names it; source `display_name` unchanged | P1 |
| RF-15e | **Plain-text `.zip` export:** a third export option below `.7z`, marked Insecure on a red card that explains the file is readable by anyone who gets it. It asks for the vault password and a folder, and has the same progress and Stop as the other exports. The vault's files sit at the zip's root, so unpacking gives a folder named after the vault with the files directly inside. A stop, a failure, a timeout, or the launch after a crash wipes the unfinished file. Purpose: a person who has the password can always take their data out | P1 |
| RF-15f | **`.upriv-config/`:** a `.7z` and a plain-text `.zip` may carry the vault's settings (`config.toml`) and file manager layout (`workspace.json`) in this folder at their root, with a `README.md`. Each has an export toggle, on by default. The create wizard has a matching switch, on by default, and applies what the file carries; a new vault never keeps the folder. A `.zip` is read when it is picked. A `.7z` is read when its password test passes, so the input fields it can fill stay locked until then, with a notice, while their steps and sections stay open. Importing works with any of this missing | P1 |
| RF-15e | **Import `.zip` / `.7z` → new vault:** stem → `display_name` in the create wizard; an invalid stem is pre-filled with a valid suggestion (`suggestValidDisplayName`), and a name already in use gets ` 2`, ` 3`, … (`suggestedImportDisplayName`); the user can edit it before Create | P0 |
| RF-15f | **`[vault] order`:** optional non-negative integer in `config.toml`; vault list sorted ascending by `order`, tie-break by `display_name`; editable in vault settings and via drag-and-drop on list | P1 |
| RF-16 | Create/import picks a free `id` (`-2`, `-3`, …); core refuses a create whose `vaults/<id>/` already exists (`vault_already_exists`) | P0 |
| RF-17 | Require `vaults/<id>/config.toml` with `[vault].id` equal to the folder name | P0 |

### 3.2 Configuration

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-20 | `settings.toml` (`[package]`, `[ui]`, `[app]`; Upriv marker) | P0 |
| RF-21 | `vaults/<id>/config.toml` per vault (security, 7z, backup, auto-close) — **editable after creation** | P0 |
| RF-22 | Secure defaults if config files missing (`archive_mode` = `encrypt_only`, etc.) | P0 |
| RF-24 | Never persist password in plaintext in vault files | P0 |
| RF-24b | **Password hint** may be stored in plaintext in `config.toml` (user-provided reminder only); UI warns it must not repeat the password | P0 |
| RF-58 | **Change password** (vault settings): current + new + confirm; vault must be **closed**. Verify the current password, write a backup zip of `store/` first, keep the same master key, and reseal the header and the name index only. File blobs stay. The same password is rejected. Unlock RAM uses the same closed-vault path (`vault_change_kdf`) | P1 |
| RF-59 | On change password: **warn** (`warning.password_change_backups`) that existing `backups/` keep the **previous** password(s); `store/` and **future** backups use the new password | P1 |
| RF-25 | **Vault config editable at any time** (app UI or edit `vaults/<id>/config.toml`) — not a "create and never change" model | P0 |
| RF-26 | Each operation reads the TOML it needs from disk, so an edit made outside the app applies on the next read | P0 |
| RF-27 | `[backup]` and `[security]` apply on the next close; `[seven_zip]` on the next `.7z` export. `[auto_close]` is read again while open (about 15 s) and keeps the current idle clock | P0 |
| RF-28 | Changing `id` requires **explicit migration** (vault closed); silent rename forbidden with an open session | P1 |

**Product principle:** creating a vault defines initial layout; **behavior options** (`archive_mode`, backup, auto-close) remain **reconfigurable** for the vault's lifetime.

### 3.3 Security and UX

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-30 | Session keys in RAM while open; zero on close. Lock does not ask for the password | P0 |
| RF-31 | Conservative `.7z` export defaults: AES-256, encrypted file names (`encrypt_file_names = true`), blocks of up to 64 MiB (`solid = false`; a larger file gets its own block), each block and the header with its own random salt and IV | P0 |
| RF-31b | Per vault: `.7z` export compression — UI presets **none / low / medium / high** mapping to `archive_mode` + `compression_level` (`encrypt_only`+0 / `compress_encrypt`+1/5/9); **default none (`encrypt_only`)** | P1 |
| RF-32 | Warning on exit with vault open | P1 |
| RF-33 | Session keys stay in RAM. Lock flushes with those keys | P0 |
| RF-35 | **Auto-close per vault:** `[auto_close]` in `vaults/<id>/config.toml` | P1 |
| RF-36 | Auto-close after `idle_minutes` with no activity inside Upriv. The clock is the device time. The interval is 1 to 1440 minutes. One vault failing does not reset the others | P1 |
| RF-37 | Activity that resets the clock is input inside Upriv. Focus, returning to the app, and edits in the mounted folder do not reset it | P1 |
| RF-38 | One notice 60 seconds before idle auto-close (30 seconds when idle is 1 minute). Fixed; not a vault setting | P2 |
| RF-39 | Auto-close uses the same close as a user close: flush `store/`, unmount, drop the session. No `.7z` pack | P0 |
| RF-40 | Global default: `enabled = false` if section missing | P0 |
| RF-41 | `upriv_plain` close and discard overwrite the plaintext folder before delete | P1 |
| RF-42 | Plaintext close does that overwrite; only Close now (RF-42b) skips it. Pass count is a hidden default of 1, not a screen | P1 |
| RF-42b | **Close now** closes one open vault with no backup, from More options below Note, on desktop and mobile. `store/` is sealed, the keys dropped, and the mount released. An `upriv_plain` folder gets no closing pass and no overwrite: changes the vault has not saved are lost, and file bytes stay on the disk until it reuses the space. It asks first (global setting, on by default, with Don't ask again); an unsaved editor tab always asks. A close already running or waiting offers it in the same menu: what is left of the final sync, the backup, and the overwrite stops, and the seal finishes. The quit dialog offers the same close for every open vault, limited to 30 s | P1 |
| RF-43 | Wipe also on recovery **Remove the folder** (`upriv_plain`) | P1 |
| RF-43b | **Only files I choose** (`[storage] plain_files`, default on) on the plain-text option, in create and vault settings, changes only while the vault is closed or in recovery. On: the folder starts empty on every open; **Send to folder** and **Remove from folder** in the file manager move a file or a whole folder in and out, and each explorer row shows what the folder holds. Off: every open writes the whole vault there. Other apps see only what is in the folder. | P1 |
| RF-43c | The file manager explorer finds files and folders by name at any depth, in both storage modes, on desktop and mobile. The search button, the fifth in the explorer toolbar, opens and closes the search bar. The bar starts closed. Each vault's layout remembers the bar and the search text, also across closing and reopening the vault. The search keeps filtering the explorer while the bar is closed, and the button says so. Folders in the results collapse and open for that search only; that is never saved and leaves the vault's expanded folders as they were. | P2 |
| RF-43d | A file the viewer cannot hold (over the preview cap, or more than free RAM holds) opens from the disk instead on `upriv_plain`: when the person opens it, a vault of chosen files sends it to the folder, and the notice offers **Open in file manager**. A tab restored with the vault writes nothing until the person presses **Send to folder**. An `encrypted_dir` vault never writes plaintext for this; with a mounted folder the notice offers that folder. | P2 |
| RF-44 | Document limit: SSD/flash **do not** guarantee physical wipe in exception mode | P1 |
| RF-45 | (`encrypted_dir`) Flush / export `.7z` using **logical content stream** (do not pack `.enc` blobs; no plaintext temp) | P0 |
| RF-46 | (`encrypted_dir`) After reboot: reopen requires password; data preserved in `store/` | P0 |
| RF-47 | **`persistence.json`** per vault: last OK close timestamp; content identity lives in `vault.header` | P0 |
| RF-48 | Recovery UI for dirty close: **Continue** (`resume_store`) unlocks the encrypted vault. A leftover plaintext folder shows a warning, and **Remove the folder** wipes it. Create-from-backup is via Backups / New vault when the store is dead — not a dirty-close peer. No silent overwrite; no fake archive-vs-store compare | P0 |
| RF-49 | The encrypted file manager folder is **virtual mount only** — forbid plaintext persistence on HD; automated tests | P0 |
| RF-49b | **Write-through:** every write via mount puts its encrypted chunk in `store/` at once; the index naming it is sealed when the file is flushed, closed, or fsynced, and within about 2 s otherwise. What the user saves never waits for vault close; a crash loses at most writes from the last 2 s that were not flushed | P0 |
| RF-50 | Export `.7z`: in-process `sevenz-rust2` pack of logical content, streamed from `store/` one chunk at a time, with progress. Fail with insufficient RAM instead of a plaintext temp | P1 |
| RF-51 | **Minimize swap** of session data buffers (`mlock` / per-OS policies where supported) | P1 |
| RF-52 | Who can open files while the vault is open is the file manager folder. Off keeps them in Upriv. On is a folder on this computer; apps that can see that path can read the files. No separate copy-out block | P1 |
| RF-53 | **Lock = close** for both modes → **`closed`** (`store/` at rest). **`upriv_plain`** also wipes workspace. | P0 |
| RF-53b | **`persistence.json`:** `persistence: "closed"` only (never `open`). Session is runtime: `"open" \| "closing" \| "recovery"`. UI `vault.status.open` = runtime only | P0 |
| RF-53c | Lock UI is **`action.lock` / `action.close` only** | P0 |
| RF-54 | **Lockfile** `runtime/<id>.lock` on vault open; refuse second open in another process/PC | P1 |
| RF-55 | Crypto primitives: Argon2id + AEAD (e.g. XChaCha20-Poly1305); protected names/paths | P0 |
| RF-56 | **Backups** UI per vault: list `backups/<stamp>-<id>.zip`, metadata, export into a chosen folder with visible progress and a stop (one zip, or one zip of several), delete, **create new vault from backup** (does not replace the source vault) | P1 |
| RF-57 | **Real states:** `open` only with active session; `closed` = `store/` at rest | P0 |

### 3.4 Rest, identity, lock, backups

At rest the vault body is **`store/`** (`header/vault.header`, `header/vault.header.copy`, encrypted `index/` + `data/` chunks). **Lock = close:** flush the session into `store/`. `store/` is the only body at rest.

**Identity:** AEAD AAD binds a **content identity** stored in `vault.header` (copied with backups), not the registry folder id. Forking a backup into a new list row must not rewrite ciphertext.

`persistence.json` records `persistence: "closed"` only (never `open`). Session is runtime: `"open" | "closing" | "recovery"`. UI `vault.status.open` = runtime only.

**`closed` means:**

1. No active session (lockfile gone)
2. Ciphertext lives in `vaults/<id>/store/`
3. `upriv_plain` workspace wiped if that mode was used

**During `open`:** write-through puts each write's ciphertext in `store/` at once and seals it on flush, close, fsync, or within about 2 s (RF-49b). UI state = **`vault.status.open`** (runtime).

**After OK close:** session keys dropped; `store/` is the rest body.

**Backups:** `backups/<stamp>-<id>.zip` is a **Stored zip of `store/`** (no zip password). Create-from-backup unpacks that snapshot into a **new** vault — never in-place restore. Export copies one `.zip` into a chosen folder, or bundles several snapshot zips into one file.

**Export** is a separate action (files stay **outside** `.upriv`): `{display_name}.zip` of `store/` (Recommended) or `{display_name}.7z` (Plan B).

**Rules:**

| Situation | State / action |
|----------|----------------|
| Active session (lock + mount / in-app FM) | `open` (runtime) |
| OK close | `closed` (`store/` at rest) |
| Dirty close / leftover plaintext workspace | **recovery** |

### 3.3.1 Threat: sensitive traces on disk

While a vault is **open**, plaintext exists only in **session RAM** (desktop: FUSE/WinFsp; mobile: in-app file manager). On ordinary disk, default mode `encrypted_dir` persists **ciphertext in `store/`** only. Close flushes the session into `store/` (lock = close). Export `.zip` of `store/`, portable `.7z`, or plain-text `.zip` is a **separate** user action; the exported file is not kept in the data folder.

| Mitigated in v1 | Outside app control |
|----------------|-------------------------|
| No persistent plaintext workspace in `encrypted_dir` | OS swap/hibernation |
| `store/` always encrypted at rest | External app cache/temp |
| File and folder names encrypted in the store (AES-SIV index; opaque `data/` blobs — forensic tools cannot map blobs to logical paths without the password) | Registry metadata still visible (`display_name`, vault folder id) |
| Password stays in session RAM and is never written to disk | Compromised host (keylogger) |
| Export streams logical content or copies ciphertext; never stages a decrypted tree | Last write if power loss during write |
| Close of `upriv_plain` overwrites the plaintext folder, then removes it | Old encrypted versions on SSD; file bytes after the person chooses Close now (RF-42b) |
| Swap minimization (RF-51) | 100% anti-swap on all OSes (platform limitation) |

**Encrypted traces on SSD:** do not expose content without the password; old ciphertext versions may remain until rotation — acceptable for confidentiality, document in UI.

**Exception mode `upriv_plain`:** plaintext `workspace/` on HD **while open**; mitigation = UI warning + overwrite of that folder on close (RF-41–44). Never use that path as a helper for `encrypted_dir`.

### 3.5 Platforms

| Phase | Platforms | Delivery |
|------|-------------|---------|
| **v1 (initial)** | **Linux + Windows** (x86_64; ARM64 if needed) | Electron + Rust; virtual mount — **FUSE** (Linux), **WinFsp** (Windows); `.7z` via `sevenz-rust2` in `upriv-core` |
| v1.1 | macOS | Electron; platform virtual mount |
| v2 | Android | React Native + `upriv-core` (Rust); OTG vault; single APK; see §3.6 |
| v3 | iOS | React Native + `upriv-core`; App Store; same vault layout; no APK on HD |

**Note:** **vault format** (`store/` under `.upriv/vaults/<id>/`) is cross-platform from the start; the **Upriv desktop app** in v1 ships on **Linux and Windows**.

#### 3.5.1 Portable mode (no install)

For a user who does not want to install anything: one file runs Upriv, and the data folder lives beside it.

| ID | Requirement | Priority |
|----|-------------|----------|
| RF-P01 | Windows ships a portable `.exe` (`Upriv-<version>-portable-x64.exe`) and Linux an AppImage (`Upriv-<version>-linux-<arch>.AppImage`). Each runs from wherever it is copied — an external HD included — with no installer and no admin rights | P0 |
| RF-P02 | The data folder (`.upriv/`) is created beside that file on first run, or opened as-is when it is already there. Moving the drive to another computer and running the same file opens the same vaults | P0 |
| RF-P03 | The portable `.exe` and the AppImage can sit side by side at the root of one drive and share the same `.upriv/` | P0 |
| RF-P04 | A folder that cannot be written (read-only drive) falls back to the user-data folder of that computer | P1 |
| RF-P05 | The portable `.exe` carries the WinFsp installer, as the setup does; it asks only when the file manager folder is turned on | P1 |
| RF-P06 | macOS has no portable build: the `.app` is always installed, with data under Application Support | — |

The installed packages (`.deb`, Windows setup) keep the data folder in the user-data folder instead. Either kind can switch to another folder in **⋯ → Data folder**. Uninstall deletes the Windows install folder, so a `.upriv/` found there (a portable copy installed over) is moved to the user-data folder at launch. When the user-data folder already has one, both stay and a notice names the folder left behind. A move that fails keeps the install folder for that launch, warns, and runs again on the next launch.

### 3.6 Android — specific requirements

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-A01 | App installed via APK (distributed in `.upriv/app/Android/Upriv.apk` in HD bundle or elsewhere) | P0 |
| RF-A02 | First run: confirm Documents via **SAF** (`ACTION_OPEN_DOCUMENT_TREE`) and create `Documents/Upriv` inside the grant, or pick another folder; persist with `takePersistableUriPermission` | P0 |
| RF-A03 | Identify vault-root by `.upriv/settings.toml`; identify a vault by `.upriv/vaults/<id>/` (`store/` at rest) | P0 |
| RF-A04 | Encrypted open creates no folder. `upriv_plain` puts its plaintext folder at the chosen place **on the vault volume**, never in the private app folder | P0 |
| RF-A05 | The **in-app file manager** is the editor. **Open in file manager** hands a folder to the system Files app (chooser) | P0 |
| RF-A06 | Same open/close/recovery cycle as desktop | P0 |
| RF-A07 | Remember the data folder grant in the private app folder — **outside** the vault folder | P1 |
| RF-A08 | A volume that stops answering shows the reconnect screen (`unreachable`); a session lost with it is a dirty close (recovery A) on the next unlock | P1 |
| RF-A09 | Plan B: user-exported `{display_name}.7z` opens with ZArchiver / similar without Upriv (an export, not rest) | P0 |
| RF-A10 | Do not support "portable app" as extracted APK folder on HD (APK → install only) | — |

**Android UX summary**

| Step | Behavior |
|-------|----------------|
| Install | Tap APK → Package Installer → app in launcher |
| Link folder | Once: confirm Documents (Upriv creates `Upriv` inside) or pick another folder |
| Open | Password → in-app file manager; plaintext only in RAM (`encrypted_dir`) |
| Edit | In-app file manager |
| Close | Flush the session into `store/`; `upriv_plain` wipes its folder |

**Accepted product limitations**

- Not every file manager handles "open in this folder" the same; use `Intent.createChooser` and test common apps.
- Paths are **URIs** (`content://`), not `E:\` — core must abstract file access via SAF.
- iOS: same vault layout, but **no** `app/iOS` binary; app only via App Store (v3 phase).

---

## 3.7 Desktop interface (UX v1 — Linux)

All visible strings use **i18n keys** in `dev/apps/shared/locales/{locale}.json` (default `en`, also `pt-BR` and `es`). See `LOCALE.md`. Buttons and states below map to keys such as `action.lock`, `vault.status.closed`.

General guideline: **simple interface**, **dark theme** by default (`[ui] theme = "dark"` in `.upriv/settings.toml`). No separate welcome screens — on app open, user sees **immediately** the **centered** vault list.

**Brand / logo (wordmark exports):** three fixed colors — white `#FFFFFF`, black `#000000`, navy `#0B0E1E` — as `.svg` / `.png` in `dev/docs/brand/` (see SDD §8.2.1).

### 3.7.1 Main screen — vault list

Each vault is a **row** with:

Vault rows are ordered by **`[vault] order`** in `config.toml` (ascending; lower = higher on screen). Vaults without `order` appear after those with an explicit value; tie-break by `display_name`.

**Changing order (UI):**

1. **Vault settings** (`action.settings`): edit **`order`** in the `[vault]` section (numeric field); save writes `config.toml`.
2. **Drag-and-drop (preferred):** on the vault list, **press and hold** a row (or its drag handle), then **drag up or down** to the desired position. On drop, the app reassigns `order` on all affected vaults and persists to each `config.toml` (atomic write). List updates immediately.

Drag must not trigger row click (open workspace) or action buttons — use a dedicated grab zone on the left (e.g. `⋮⋮` handle beside the status dot) or long-press on the name area; action buttons keep `stopPropagation`.

| Zone | Content |
|------|----------|
| **Left** | Vault name + **status dot** (color per `open` / `closed` / `recovery`) |
| **Right** | Action buttons (order below) |

**Button order (left → right in right area):**

1. **`action.backups`** — opens vault backup list modal.
2. **`action.settings`** — opens modal with all vault-specific settings (includes delete vault; see §3.7.3).
3. **`action.lock` / `action.unlock`** — **larger, more prominent** button (primary visual of row). `action.unlock` when closed; `action.lock` when open (starts close).

**Row click (outside buttons):**

- Vault **`open`:** open **workspace** directory in OS file manager (`xdg-open` on Linux).
- Vault **`closed`:** do not open folder; unlock via **`action.unlock`** button (prompts password).

**Row background / outline color** by persisted or runtime state:

| State | Visual feedback (suggestion) |
|--------|----------------------------|
| `open` | Highlight (e.g. border or background with green/teal tone) |
| `closed` | Neutral (base dark theme) |
| `recovery` | Warning (e.g. orange/red) until resolved |

Left dot uses **same color semantics** as row outline.

### 3.7.2 Modal — backups

Opened by **`action.backups`** on vault row.

- Lists each file in `backup/<id>/` (name, date, optional size).
- Each row: **name**, **date**, **`action.delete`** button.
- **Delete backup:** confirmation with text field — user must **type vault name** (`id`) to enable delete button.
- Future actions in same list: open with 7-Zip. **No in-place restore** — user creates a **new vault** via import wizard seeded from the backup `.7z`.

### 3.7.3 Modal — vault settings

Opened by **`action.settings`** on vault row.

- Edits vault `config.toml` via a **subset** of sections (RF-UI-04, SDD §3.2.3a). **Explicit Save** when dirty (with confirm); closing with unsaved edits prompts **discard all and close**.
- **`[vault]` in UI:** `display_name`, optional **`order`** (same as drag-and-drop reorder), optional **`note`**, optional **`password_hint`**. **Not shown:** `id` (folder slug; migrates when display name normalizes).
- **`[security]` in UI:** nothing. Change password is the Password area (vault closed). Plaintext close overwrites the open folder; only Close now skips that (RF-42b). **Not shown:** `wipe_passes`, `wipe_pattern`.
- **`[seven_zip]` in UI:** compression preset (**none / low / medium / high**) + `encrypt_file_names` (`method`/`solid` = defaults; level derived from preset).
- **`modal.settings.danger_zone` section:** **`modal.settings.delete_vault`** — confirmation with text field; user must **type vault name** (`id`) to confirm deletion (removes `.7z`, store, config entries, and backups per policy).

### 3.7.4 Interface requirements (RF-UI)

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-UI-01 | Dark theme by default; simple layout | P0 |
| RF-UI-02 | Initial screen = centered vault list (no separate welcome) | P0 |
| RF-UI-03 | Row: name + status dot; row color by `open`/`closed`/`recovery` | P0 |
| RF-UI-04 | Per-vault settings modal (TOML); delete vault with name confirmation | P0 |
| RF-UI-05 | Backups modal; delete backup only after typing vault `id` | P0 |
| RF-UI-06 | Prominent Lock/Unlock button (larger visual weight than others) | P0 |
| RF-UI-07 | Row click (outside buttons) opens workspace when `open` | P0 |
| RF-UI-08 | **Export** (`action.export_vault`) from the overflow menu. User chooses `.zip` of `store/` (Recommended) or `.7z` | P0 |
| RF-UI-09 | Row buttons do not propagate click to row (stop propagation) | P0 |
| RF-UI-10 | Transient screens: unlock (password), recovery; open/close progress on the **row** (and unlock dialog while open) with a finite time budget — **no** blocking full-screen pipeline overlay. Lock starts the close pipeline immediately and does not ask for the password. **One pipeline at a time** — open/close/create are **queued** (FIFO); no cancel mid-flush | P0 |
| RF-UI-11 | **Create vault** modal/wizard: name, password, confirm password, optional hint, optional note | P0 |
| RF-UI-12 | Unlock screen may show **`password_hint`** from config when non-empty (never auto-fill password) | P1 |
| RF-UI-13 | **Reorder vault list:** drag-and-drop rows (press/hold + drag); persist new positions to `[vault] order` in each affected `config.toml` | P1 |
| RF-UI-14 | Vault settings modal exposes **`order`** field under `[vault]` (alternative to drag-and-drop) | P1 |
| RF-UI-15 | Vault settings: **Save** only when dirty (with confirm); close/backdrop/Esc with unsaved edits → confirm **discard all and close**; field visibility per SDD §3.2.3a | P1 |
| RF-UI-16 | Minimized file-manager dock: expand/collapse toggle persists `[ui] file_manager_dock_expanded` on each open/close of the dock list; **not** a System settings field (SDD §3.1) | P1 |
| RF-UI-17 | **Storage mode warnings:** `warning.encrypted_dir_ram` / `warning.upriv_plain` | P0 |

### 3.7.5 File manager — minimized dock

When the user minimizes a per-vault file manager, a **dock** (bottom-right) lists open minimized managers. A single control expands or collapses the chip list. The choice is saved to **`[ui] file_manager_dock_expanded`** in `.upriv/settings.toml` **on each toggle** and restored on the next app session. There is **no** separate “keep dock expanded” option in the System settings modal.

---

## 4. Session

Unlock asks for the password once. Session keys stay in RAM. Lock flushes with those keys. Quit or reboot asks again. Change password is a separate flow.

The password string stays in the app after a successful unlock, until lock or quit. A wrong password or a dismissed attempt does not stay.

**Warnings:**

- **RAM capacity:** show **`warning.encrypted_dir_ram`** when `encrypted_dir` (settings + create wizard). Insufficient memory → open/edit/close may fail (no silent spill to plaintext disk).
- **`upriv_plain`:** show **`warning.upriv_plain`** (plaintext while open); radio badge **not recommended**. Lock starts the close immediately and does not ask for the password.

---

## 5. Vault structure (product contract)

```
<data-folder>/
├── Upriv-<version>-portable-x64.exe        # portable Windows app (§3.5.1), when used
├── Upriv-<version>-linux-<arch>.AppImage   # portable Linux app, when used
├── .upriv-data-folder                      # only after the user picked another data folder
├── workspace/                              # file manager folders while open (place = beside)
│   └── <display name>/
└── .upriv/
    ├── settings.toml                       # marker + app settings ([package] version = 1)
    ├── state.json                          # open sessions (volatile)
    ├── vault_groups.toml                   # vault list groups
    ├── logs/                               # app logs (no vault content)
    ├── runtime/<id>.lock                   # one open per vault
    ├── app/                                # reserved for app files kept with the data folder
    └── vaults/<id>/
        ├── config.toml                     # [vault] id = folder name, display_name, …
        ├── persistence.json                # closed-only rest metadata
        ├── store/                          # ciphertext: header/, index/, data/
        └── backups/<stamp>-<id>.zip        # Stored zip of store/ (pins in backups/saves/)
```

**Clean root:** the user sees the portable app files (when used), `workspace/` while a folder is open there, and `.upriv/`; everything else is under `.upriv/`. Passwords are never stored.

**Desktop:** working folder = contains `.upriv/settings.toml`.

**Android:** vault identified by **SAF URI** of root folder; app installed separately from APK.

---

## 6. Non-functional requirements

| ID | Requirement |
|----|-----------|
| RNF-01 | Typical vault (passwords/docs): open/close in seconds to a few minutes |
| RNF-02 | Comfortable size per vault: up to ~1 GB uncompressed; up to ~3 GB with care on desktop |
| RNF-03 | Single executable per OS (Electron); Windows and Linux also run as one portable file with no install (§3.5.1); no separate `7zz` binary |
| RNF-04 | UTF-8 config; the `.upriv/` layout is fixed in code, and the only stored paths are folders the user chose (absolute) |
| RNF-05 | Core code in Rust (`upriv-core`); desktop UI React web + Electron; mobile UI React Native + Rust FFI (later phases). UI layers are presentation only — crypto, RAM session, and disk I/O live in Rust. See `ARCHITECTURE.md` |
| RNF-05b | **v1:** desktop app **Linux + Windows**; vault format and `.7z` portable from the start |
| RNF-06 | License and dependencies compatible with `sevenz-rust2` |

---

## 7. Success metrics (MVP)

- User creates vault, adds files, closes and reopens on another PC with same `.7z`.
- After simulating crash (orphan workspace), recovery closes vault without corrupting `store/`.
- A wrong unlock password does not change `store/`. Lock does not ask for the password.
- Opening an exported `{display_name}.7z` with external 7-Zip works with same password.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|-------|-----------|
| `store/` differs from the last close | `content_hash` in `persistence.json` → recovery A (RF-47–48) |
| User ejects HD with vault open | Warning + recovery; lockfile; encrypted store preserves data |
| Wrong password after reboot | Unlock goes through Argon2id; a wrong password does not write `store/` |
| Corruption on close | Flush `store/` only after the index seal succeeds; optional `backups/` |
| Poorly implemented virtual workspace | RF-49 + integration tests |
| `.7z` export RAM | RF-50 (in-process pack, or fail — no plaintext temp) |
| Swap leaks session | RF-51 (minimize; document limit) |
| External apps read an open folder | File manager folder off keeps files in Upriv (RF-52) |
| Plaintext traces after `upriv_plain` | Close overwrites the folder before removing it (RF-41–44); SSD/flash limits are documented |
| Two PCs on same USB | RF-54 lockfile + warning |
| External 7-Zip vs in-app export | Do not spawn `7zz`; pack with `sevenz-rust2` |
| Very large vault / insufficient RAM | UI documents limits (`warning.encrypted_dir_ram`); split vaults; or **`upriv_plain`** |
| Android: OTG disconnected with vault open | Recovery; UI warnings |
| Android: Intent doesn't open folder in some manager | Chooser + document tested apps |
| Android: storage scope | SAF mandatory |
| Accumulated backups | RF-56 UI; `keep_last` policy / delete old |

---

## 9. Suggested roadmap

### MVP (v0.1)
- **Linux + Windows desktop** (first implementation)
- **Storage modes (UI):** `encrypted_dir` (default), `upriv_plain` — warnings per §1.6
- `encrypted_dir` flow: `store/` → virtual `workspace` → close → flush `store/`
- `upriv_plain` flow: `store/` → plaintext `workspace` → close → `store/` + wipe workspace
- Compression presets for `.7z` export (none/low/medium/high → RF-31b)
- `settings.toml` + defaults
- Basic recovery + `persistence.json` (RF-47–48)
- States `open` / `closed`
- Session keys in RAM; lock does not ask; no password file on disk
- Virtual mount + anti-plaintext tests (RF-49)
- Vault list UI + dark theme (RF-UI-01–10; §3.7)

### v0.2
- Backup zips in `vaults/<id>/backups/` (`keep_last` / `keep_all`)
- Settings UI

### v0.3
- macOS (v1.1)

### v0.4 — Android
- React Native + `upriv-ffi` (UniFFI); single APK bundles UI, bridge, and `libupriv_ffi.so`
- Storage-access data folder: Documents/Upriv, or a picked folder (OTG HD included)
- In-app file manager; `upriv_plain` folder at the chosen place
- Open/close vault; OTG recovery
- Open in file manager (system Files app)
- APK in `.upriv/app/Android/` in HD bundle
- Documented Plan B (ZArchiver + exported `{display_name}.7z`)

### v1.0
- iOS (App Store; no APK on HD)
- Polish, documentation, HD bundle installer

---

## 10. Product references (context)

- **Cryptomator:** mounted-folder vault UX; proprietary format; paid mobile.
- **7-Zip / ZArchiver:** `.7z` format; no lifecycle orchestration.
- **LUKS:** block/partition; not cross-platform on exFAT.
- **YukiCrypt:** single `.ykc` file; desktop; not 7z.

Upriv = **vault UX** + **universal 7z container**.

---

## 11. Layers and glossary

### 11.1 Layers (official abstraction names)

| Layer (ID) | UI (i18n) | What | Path / runtime |
|-------------|---------|-------|----------------|
| **`store`** | — | Ciphertext at rest | `vaults/<id>/store/` |
| **`session`** | `layer.session` | Active logical view (mount + RAM) | virtual file manager folder |
| **`plain`** | `layer.plain` | `upriv_plain` only: files in plaintext on disk while open | real folder from the workspace place |

Open: **`store` → `session`** (or **`plain`**). Close: flush back to **`store`**.

`storage.mode` in TOML:

| `storage.mode` | Layers used |
|----------------|----------------|
| `encrypted_dir` | `store` + `session` (default) |
| `upriv_plain` | `store` + `plain` |

Suggested Rust modules: `upriv_core::store`, `::session`, `::plain`.

### 11.2 Glossary

| Term | Definition |
|-------|-----------|
| Vault / vault-root | Folder `<vault-root>` with standardized layout (not the vault itself) |
| **`store`** | Ciphertext at rest — `vaults/<id>/store/` |
| **`session`** | Virtual mount + keys in RAM (`encrypted_dir`) |
| **`plain`** | Plaintext workspace on disk while `upriv_plain` is open |
| Close vault | Flush session into `store/` → unmount → zeroize RAM |
| `open` | Active `session` (runtime) |
| `closed` | `store/` at rest |
| Export | Separate action: `.zip` of `store/` (Recommended), `.7z`, or plain-text `.zip` (Insecure) |
| SAF | Storage Access Framework (Android) |
| Vault URI | `content://` reference to vault root on Android |

---

*Document intended to align implementation (see SDD.md) and onboarding of other AIs or developers.*
