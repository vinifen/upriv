# PRD — Upriv

**Language:** English (UI copy: `dev/apps/shared/locales/` — see `LOCALE.md`)

> **Rest layout, storage modes, backups, and export:** [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md). Two modes (`encrypted_dir`, `upriv_plain`); rest = `contents/`; lock = close; export is an action (`.zip` of `contents/` or `.7z`).

**Product Requirements Document**  
**Version:** 0.2  
**Date:** 2026-05-31  
**Status:** Draft for implementation kickoff  
**Companion:** `sdd.md`, `ARCHITECTURE.md`

---

## 1. Product vision

### 1.1 What it is

Upriv is a **portable vault manager**. At rest the vault body is **`contents/`** (Argon2id → HKDF → XChaCha20-Poly1305 chunks, AES-SIV names). **Lock = close** (flush the session into `contents/`). There is **no Seal**. Portable files are a **separate export action**: recommended ordinary **`.zip` of `contents/`** (zip is an envelope, no zip password) or **`.7z`** (logical Plan B). Canonical protocol: [`.agent/SECURITY-CRYPTO.md`](../../.agent/SECURITY-CRYPTO.md).

**v1 (initial goal):** both storage modes on **Linux and Windows desktop** (Electron + `upriv-daemon` + `upriv-core`): default **`encrypted_dir`** (FUSE on Linux, WinFsp on Windows; decrypt in RAM) and exception **`upriv_plain`** (real plaintext `workspace/` on disk while open, UI warning + wipe on close). macOS and mobile follow the same layout (in-app file manager on mobile — no FUSE).

The user opens with a password, edits via a virtual mount / in-app file manager (or plaintext `workspace/` in `upriv_plain`), ciphertext stays in `.upriv/vaults/<vault_id>/contents/`, and close writes the session back into `contents/`. Export (when the user asks) writes `{display_name}.zip` or `{display_name}.7z` **outside** the vault directory — never a durable twin beside `contents/`.

Differentiators vs. manual 7-Zip use:

- Guided flow: **Open vault → Work → Close vault**
- **Standardized** vault-oriented layout (`.upriv/settings.toml`, `vaults/<vault_id>/` per vault)
- Works on **external HD, local system folder, or synced cloud** (as long as the vault is a folder)
- **Plan B:** export a `.7z` that opens in 7-Zip / ZArchiver (weaker offline guessing than `contents/`; honest copy — not “more secure than 7-Zip”)
- Recovery after dirty close, leftover `upriv_plain` workspace, or a dead header (create from backup)

### 1.2 Problem it solves

| Problem | Upriv solution |
|----------|-----------------|
| LUKS / BitLocker don't open on all devices | Portable `contents/` + optional `.7z` export |
| Cryptomator: proprietary format; paid mobile | Open protocol in `contents/`; Android later |
| Manual 7-Zip: easy to forget to recompress; plaintext folder on HD | Encrypted `contents/` + virtual workspace; `.7z` only on export |
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
- Seal / `sealed` / a durable `.7z` twin of `contents/`.
- Replace full-disk encryption at OS/firmware level.

### 1.6 Storage modes (shipping)

**Two modes.**

| Mode | ID | When to use | Close behavior | v1 UI |
|------|-----|-------------|----------------|-------|
| **Encrypted directory (default)** | `encrypted_dir` | Normal use. Rest = `contents/`. While open: decrypt in RAM (FUSE/WinFsp; in-app file manager on mobile). | Lock = close → flush session into `contents/` → `closed` | **Yes** |
| **Plaintext folder while open** | `upriv_plain` | Large vaults / when RAM cannot hold the working set. Rest = `contents/`. While open: real plaintext `workspace/`. UI badge **Insecure**. | Lock = close → write `contents/` → wipe workspace → `closed` | **Yes** |

**`encrypted_dir` RAM:** decrypted content is served through the virtual mount / session buffers. Open, edit, or close may **fail** if RAM is insufficient — never silently spill plaintext to ordinary disk. UI: `warning.encrypted_dir_ram`. Prefer **`upriv_plain`**, smaller vaults, or more RAM when hardware cannot meet this limit.

The user chooses the mode in `vaults/<id>/config.toml` (`[storage] mode`). UI warnings: `warning.encrypted_dir_ram`, `warning.upriv_plain`.

**Helpers (shared domain):** `storageModeHasClosedCache` = both modes; `storageModeHasPortableArchive` = both (export is an action, not rest); `storageModeIsPlaintext` = `upriv_plain`.

### 1.7 Vault states

**Rule:** on disk, persistence is always **`closed`** (`contents/` present). **`open` is runtime only.**

| State (ID) | UI (i18n) | What exists |
|-------------|---------|----------------|
| **`open`** | `vault.status.open` | Session + mount (or plaintext `workspace/` for `upriv_plain`) + `contents/` |
| **`closed`** | `vault.status.closed` | `contents/` at rest; no session |

```text
encrypted_dir / upriv_plain:
  closed ──open──► open ──close──► closed
  # upriv_plain open: plaintext workspace (wipe on close)
```

- Implementation transients: `closing`, `opening`, `recovery` (not resting UI states).
- **`open`:** active lock + mount (or plaintext workspace) + session key in RAM. Folders on disk are **not** sufficient.
- **`closed`:** `contents/` + `persistence.json` `closed` + no active session.
- **Recovery:** dirty close, leftover `upriv_plain` workspace, or dead header/index (create a **new** vault from backup — do not dual-pick archive vs store).

**Detection on startup (per vault):**

| Situation | Result |
|----------|-----------|
| Active lock + mount | `open` |
| Dirty close / leftover plaintext workspace | **`recovery`** |
| `contents/` + manifest `closed` | `closed` |
| Dead header/index | recovery → create from backup only |

### 1.9 v1 flows (both modes)

#### `encrypted_dir` (default)

| Step | What |
|-------|--------|
| 1 | **Open:** unlock `contents/` (`vault.header`); decrypt in RAM. |
| 2 | **Session:** mount virtual `workspace/<id>/` (desktop) or in-app file manager (mobile). No durable plaintext tree on ordinary disk. |
| 3 | **Edit:** each save updates the session **and** persists ciphertext chunks in `contents/`. |
| 4 | **Close:** flush session into `contents/`; optional backup = frozen copy of `contents/` under `backups/<stamp>/`. |
| 5 | **Close:** unmount, zero password/keys in RAM → **`closed`**. |

#### `upriv_plain` (plaintext while open)

| Step | What |
|-------|--------|
| 1 | **Open:** decrypt `contents/` into plaintext `workspace/<id>/` on disk. |
| 2 | **Edit:** real files on disk (UI warning). |
| 3 | **Lock:** always **close** → encrypt workspace into `contents/` → **`secure_wipe_workspace`** → **`closed`**. |

**Accepted trade-off (v1):** after reboot, the user **must re-enter the password** to open again (default `session_ram`). Data in `contents/` is not lost. Crash while `upriv_plain` is **open** leaves plaintext on disk until close/wipe.

**Export (separate action):** user chooses `.zip` of `contents/` (Recommended) or portable `.7z`. Open vaults export **after flushing** `contents/` (edits included; vault stays open). `.7z` never stores `.enc` blobs; zip envelope has **no** zip password.

### 1.8 Technical mitigations (architecture)

| # | Risk | Product mitigation |
|---|--------|----------------------|
| 1 | Incomplete close | Recovery: resume from `contents/`, create from backup, or wipe leftover plaintext |
| 2 | Dead `vault.header` / index | New vault from a `backups/<stamp>/` copy — not a dual store/`.7z` picker |
| 3 | Direct writes to `workspace/` on HD (`encrypted_dir`) | **Virtual** mount (FUSE/WinFsp) or in-app FM; tests that forbid persistent plaintext |
| 4 | `7zz` temp when exporting `.7z` | Stream logical content; never stage a decrypted tree for zip/7z |
| 5 | Swap/hibernation | **Minimize** swap of sensitive buffers (`mlock`, RAM buffers); do not promise 100% on all OSes |
| 6 | External apps (Word, etc.) | Editing via mount allowed; warn about copies in `%TEMP%`; "internal editor only" option for critical files |
| 7 | Encrypted traces on SSD | Ciphertext in `contents/` / `backups/`; `upriv_plain` wipe is best-effort on flash |
| 8 | Two PCs on same HD | `runtime/<id>.lock` + warning; simultaneous use remains user responsibility |
| 9 | `plain` mode | Strong UI warning; wipe on close (documented SSD limits) |
| 10 | Custom crypto | Standard primitives (Argon2id + AEAD); universality/portability via **`.7z`** |
| 11 | Old backups | UI: list/download/delete; **create new vault from backup** (no in-place restore) |

**Store encryption:** use the most mature and auditable libraries and formats possible (do not reinvent AEAD/KDF). Plan B and backups remain in **7z**.

---

## 2. Main use cases

### UC-0 — Create new vault (from scratch, not import)

1. User clicks **`app.new_vault`** on the vault list screen.
2. Enters **`display_name`** (validated per RF-15b).
3. Enters **password** and **confirm password** (required; must match).
4. Optionally enters a **password hint** (reminder only — not the password).
5. Optionally enters a short **vault note** (simple annotation for the user).
6. App creates `vaults/<vault_id>/` layout, writes `config.toml` (including hint/note if provided), and initializes `contents/`.
7. Vault opens (or appears in the list as `closed`).

**Import path (RF-15e) is different:** external `.7z` → new vault uses the archive’s existing password to validate; no new password wizard unless the user chooses **change password** later.

### UC-1 — Vault on external HD (exFAT)

1. User connects HD with pre-created structure or creates vault at volume root.
2. Runs one of 3 launchers at root: `Upriv-windows.exe`, `Upriv-mac`, or `Upriv-linux`.
3. Enters password → virtual `workspace/<id>/` appears → edits files.
4. **Close vault** → `workspace/<id>/` is unmounted; only encrypted vault data persists (and `.7z` if enabled/exported).

### UC-2 — Vault in system folder

1. App installed or portable anywhere.
2. Menu **Open vault** → selects folder containing `.upriv/settings.toml`.
3. Same open/close flow.

### UC-3 — Recovery after crash

1. HD mounted; `workspace/` or open-vault marker exists, but app was not running.
2. App detects inconsistent state.
3. User enters password → app validates vault state and offers to recover encrypted session or discard virtual `workspace/`.

### UC-4 — Plan B without Upriv

1. User **exports** `{display_name}.zip` (Recommended — ciphertext envelope) or `{display_name}.7z` (logical Plan B). Neither file lives in the vault at rest.
2. Opens the `.7z` with 7-Zip / ZArchiver + password (documented in `README.md` at vault root if needed). The zip lists opaque ciphertext; only Upriv decrypts it.

### UC-5 — Vault on Android (OTG HD)

1. **First time on phone:** user installs Upriv from `.upriv/app/Android/Upriv.apk` (on HD) or another source; opens app from Android launcher.
2. **Link vault:** app prompts **"Select vault"** → user chooses **root folder** (`<vault-root>`) where `workspace/` (optional), `.upriv/settings.toml`, and (on desktop) launcher `Upriv-<so>.*` exist at root; grants persistent permission.
3. **Open vault:** enter password → app validates and opens virtual view in `workspace/` (default mode) or extracts in exception mode (`plain`, when available).
4. **Work:** button **`action.open_folder`** → Intent → system file manager (Files, Solid Explorer, etc.) opens `workspace/`; user edits with third-party apps.
5. **Close vault:** in Upriv → unmount `workspace/<id>/`; in exception mode also recompress to `.7z`, wipe, and remove plaintext workspace.
6. **Next times:** open installed app; use already authorized vault URI (no need to reinstall APK if app stays installed).

**Android v1 non-goal:** run app "unpacked" from HD folder (without installation); do not replace file manager — only delegate via Intent.

---

## 3. Functional requirements

### 3.1 Vault lifecycle

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-01 | Create new vault (`vaults/<vault_id>/` layout + `.upriv/settings.toml` + `contents/`) | P0 |
| RF-01b | **Create-new wizard (not import):** require password + confirm password; optional **password hint** field | P0 |
| RF-01c | **Vault note:** optional user annotation per vault (max 10 000 characters); editable in create wizard and vault settings | P1 |
| RF-01d | Store `password_hint` and `note` in **`config.toml` `[vault]`** — not in `persistence.json`, not a separate notes file (v1) | P0 |
| RF-02 | Open vault (`encrypted_dir` default): validate password, mount virtual `workspace/<id>/`, load encrypted store | P0 |
| RF-03 | Expose `workspace` to user (button `action.open_folder` → OS file manager) | P0 |
| RF-04 | Close vault (`encrypted_dir`): unmount `workspace/<id>/`, flush session into `contents/` using **session keys** (not a newly typed password), clear session keys. Default lock has **no password prompt** | P0 |
| RF-04h | `upriv_plain` mode: rest = `contents/`; while open plaintext `workspace/`; UI **`warning.upriv_plain`** + badge **insecure**; lock always **close** + wipe workspace → `closed`. UI confirms wipe; password only if `always_prompt` | P1 |
| RF-04c | (`encrypted_dir`) Require sufficient RAM for the **entire unlocked vault** while open; fail open/edit/close with user-visible error if not; UI **`warning.encrypted_dir_ram`** (RF-UI-17) | P0 |
| RF-05 | On close: verify **open session / `vault.header`** before backup or flush — failure aborts; `contents/` unchanged. Do **not** rewrap the header from a typed close password. Optional `always_prompt` re-asks as a **presence check** against that session only | P0 |
| RF-06 | Atomic write of `contents/` (header + index + chunks); never a durable `.7z` twin beside `contents/` | P0 |
| RF-07 | Backup on close: copy `contents/` to `backups/<stamp>/` if `[backup] enabled` | P1 |
| RF-07b | Modes: `keep_last` (only latest backup) or `keep_all` (history) | P1 |
| RF-08 | Recovery UI if workspace/marker exists with vault logically "closed" | P0 |
| RF-09 | Open existing vault via `--vault <path>` or dialog | P0 |
| RF-10 | Remember last vault in app profile (outside vault folder) | P2 |
| RF-11 | **Multiple vaults** per HD: one `.toml` + encrypted store per vault (and optional `.7z` per vault) | P1 |
| RF-12 | Virtual workspace = `{mount_parent}/{display_name}/` where mount parent is app `[workspace].path` or vault `[mount].workspace_path` (not auto-created at init). Legacy docs said `workspace/<id>/` under the vault-root — superseded. | P0 |
| RF-13 | Discover vaults by listing `config/*.toml` (filename / `id` field) | P0 |
| RF-14 | Open/close vaults **independently** (several open at once) | P1 |
| RF-15 | **Unique `vault_id`:** normalized slug for `vaults/<vault_id>/`; `display_name` for UI / main `.7z` / `workspace/` | P0 |
| RF-15b | **Validate `display_name`:** reject `\ / : * ? " < > \|`, controls, empty, trailing space/`.`, reserved Windows stems, length > 128; allow Unicode accents and spaces | P0 |
| RF-15c | **`vault_id` slug:** normalize from `display_name` (lowercase, spaces→`-`, strip forbidden, optional accent fold); max 64 chars; collision suffix | P0 |
| RF-15d | **Export:** default `{display_name}.zip` (ordinary zip of encrypted `contents/`) or `{display_name}.7z`; if save path invalid, block or minimal sanitize filename only; source `display_name` unchanged | P1 |
| RF-15e | **Import `.zip` / `.7z` → new vault:** stem → `display_name`; if invalid, dialog with `sanitize_minimal` pre-fill + user confirm | P0 |
| RF-15f | **`[vault] order`:** optional non-negative integer in `config.toml`; vault list sorted ascending by `order`, tie-break by `display_name`; editable in vault settings and via drag-and-drop on list | P1 |
| RF-16 | Reject create/import if `id` already exists in config, `vaults/`, or `workspace` | P0 |
| RF-17 | Require `config/<id>.toml` with `id` field equal to filename (without `.toml`) | P0 |

### 3.2 Configuration

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-20 | `settings.toml` (`[package]`, `[ui]`, `[app]`; Upriv marker) | P0 |
| RF-21 | `config/*.toml` per vault (security, 7z, backup, auto-close) — **editable after creation** | P0 |
| RF-22 | Secure defaults if config files missing (`archive_mode` = `encrypt_only`, etc.) | P0 |
| RF-23 | Configurable password/session retention modes (see §4) | P1 |
| RF-24 | Never persist password in plaintext in vault files | P0 |
| RF-24b | **Password hint** may be stored in plaintext in `config.toml` (user-provided reminder only); UI warns it must not repeat the password | P0 |
| RF-58 | **Change password** (vault settings / Security UI): require **current** + new + confirm; works with vault **open or closed**; `upriv-core` validates current password, re-encrypts main archive and store (RAM/temp pipeline), atomically replaces files | P1 |
| RF-59 | On change password: **warn** (`warning.password_change_backups`) that existing `backups/` keep the **previous** password(s); `contents/` and **future** backups use the new password | P1 |
| RF-25 | **Vault config editable at any time** (app UI or edit `config/<id>.toml`) — not a "create and never change" model | P0 |
| RF-26 | App **reloads** TOML on startup, on vault focus, and when file changes (idempotent reload) | P0 |
| RF-27 | Changes to `[seven_zip]`, `[backup]`, `[auto_close]`, `[security]` apply on **next** relevant cycle (close/open), with UI warning if vault is open | P0 |
| RF-28 | Changing `id` requires **explicit migration** (vault closed); silent rename forbidden with an open session | P1 |

**Product principle:** creating a vault defines initial layout; **all behavior options** (`archive_mode`, backup, auto-close, session, etc.) remain **reconfigurable** for the vault's lifetime.

### 3.3 Security and UX

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-30 | Password in RAM during session (default mode); zero on close | P0 |
| RF-31 | Conservative 7z parameters in both modes: `-mhe=on`, AES-256, `-ms=off` | P0 |
| RF-31b | Per vault: compression on close — UI presets **none / low / medium / high** mapping to `archive_mode` + `compression_level` (`encrypt_only`+0 / `compress_encrypt`+1/5/9); **default none (`encrypt_only`)** | P1 |
| RF-32 | Warning on exit with vault open | P1 |
| RF-33 | Session security levels (5 modes) — see SDD | P2 |
| RF-34 | `session.enc` for disk modes (encrypted session key, not password) | P2 |
| RF-34b | `session.enc` (encrypted session key, never plaintext password) allowed in **both** storage modes when user picks `disk_close` or `disk_open_close`; default remains `session_ram`; UI badges less-secure / insecure | P0 |
| RF-35 | **Auto-close per vault:** `[auto_close]` in `config/<id>.toml` | P1 |
| RF-36 | Auto-close after `idle_minutes` without activity on open vault | P1 |
| RF-37 | Activity = app UI + changes in `workspace/<id>/` (virtual filesystem watch) | P1 |
| RF-38 | Optional `warn_before_seconds` warning before auto-close | P2 |
| RF-39 | Auto-close uses same v1 `close()` flow (7z t → `.7z.new` → unmount → zeroize) | P0 |
| RF-40 | Global default: `enabled = false` if section missing | P0 |
| RF-41 | **`secure_wipe_workspace`** (`upriv_plain`): on close/discard, overwrite plaintext files before delete | P1 |
| RF-42 | Default `secure_wipe_workspace = true` in exception mode; configurable `wipe_passes` (1–3 on HD) | P1 |
| RF-43 | Wipe also on recovery **DiscardWorkspace** in exception mode | P1 |
| RF-44 | Document limit: SSD/flash **do not** guarantee physical wipe in exception mode | P1 |
| RF-45 | (`encrypted_dir`) Flush / export `.7z` using **logical content stream** (do not pack `.enc` blobs; no plaintext temp) | P0 |
| RF-46 | (`encrypted_dir`) After reboot: reopen requires password; data preserved in `contents/` | P0 |
| RF-47 | **`persistence.json`** per vault: last OK close timestamp; content identity lives in `vault.header` | P0 |
| RF-48 | Recovery UI: **`recovery.resume_contents`**, **`recovery.create_from_backup`**, or **`recovery.discard_workspace`** (no silent overwrite; no fake archive-vs-store compare) | P0 |
| RF-49 | `workspace/<id>/` in `encrypted_dir` is **virtual mount only** — forbid plaintext persistence on HD; automated tests | P0 |
| RF-49b | **Write-through:** every committed write via mount persists immediately to `contents/`; what user saves in session is not "RAM only" | P0 |
| RF-50 | Export `.7z`: mitigate `7zz` temp (stream, temp in `tmpfs` if available, post-export cleanup) | P1 |
| RF-51 | **Minimize swap** of session data buffers (`mlock` / per-OS policies where supported) | P1 |
| RF-52 | **External editor policy:** allow editing via mount; warn temp-outside-vault risk; option to restrict to integrated editor | P1 |
| RF-53 | **Lock = close** for both modes → **`closed`** (`contents/` at rest). **`upriv_plain`** also wipes workspace. | P0 |
| RF-53b | **`persistence.json`:** `persistence: "closed"` only (never `open`). Session is runtime: `"open" \| "closing" \| "recovery"`. UI `vault.status.open` = runtime only | P0 |
| RF-53c | Lock UI is **`action.lock` / `action.close` only** | P0 |
| RF-54 | **Lockfile** `runtime/<id>.lock` on vault open; refuse second open in another process/PC | P1 |
| RF-55 | Crypto primitives: Argon2id + AEAD (e.g. XChaCha20-Poly1305); protected names/paths | P0 |
| RF-56 | **Backups** UI per vault: list `backups/<stamp>/` (frozen `contents/`), metadata, download, delete, **create new vault from backup** (does not replace the source vault) | P1 |
| RF-57 | **Real states:** `open` only with active session; `closed` = `contents/` at rest | P0 |

### 3.4 Rest, identity, lock, backups

At rest the vault body is **`contents/`** (`vault.header` + encrypted `index/` + `data/` chunks). **Lock = close:** flush the session into `contents/`. There is **no Seal**, no `stores/<id>/`, and no durable `vaults/<id>.7z` twin beside the store.

**Identity:** AEAD AAD binds a **content identity** stored in `vault.header` (copied with backups), not the registry folder id. Forking a backup into a new list row must not rewrite ciphertext.

`persistence.json` records `persistence: "closed"` only (never `open`). Session is runtime: `"open" | "closing" | "recovery"`. UI `vault.status.open` = runtime only.

**`closed` means:**

1. No active session (lockfile gone)
2. Ciphertext lives in `vaults/<id>/contents/`
3. `upriv_plain` workspace wiped if that mode was used

**During `open`:** write-through updates `contents/` immediately (RF-49b). UI state = **`vault.status.open`** (runtime).

**After OK close:** session keys dropped; `contents/` is the rest body.

**Backups:** `backups/<stamp>/` is a **frozen copy of `contents/`** (no `snapshot.toml`). Create-from-backup copies that tree into a **new** vault — never in-place restore.

**Export** is a separate action (files stay **outside** `.upriv`): `{display_name}.zip` of `contents/` (Recommended) or `{display_name}.7z` (Plan B).

**Rules:**

| Situation | State / action |
|----------|----------------|
| Active session (lock + mount / in-app FM) | `open` (runtime) |
| OK close | `closed` (`contents/` at rest) |
| Dirty close / leftover plaintext workspace | **recovery** |

### 3.3.1 Threat: sensitive traces on disk

While a vault is **open**, plaintext exists only in **session RAM** (desktop: FUSE/WinFsp; mobile: in-app file manager). On ordinary disk, default mode `encrypted_dir` persists **ciphertext in `contents/`** only. Close flushes the session into `contents/` (lock = close). Export `.zip` of `contents/` or portable `.7z` is a **separate** user action — not a durable twin beside the store. No Seal, no `stores/<id>/`, no leftover `.7z` as rest.

| Mitigated in v1 | Outside app control |
|----------------|-------------------------|
| No persistent plaintext workspace in `encrypted_dir` | OS swap/hibernation |
| `contents/` always encrypted at rest | External app cache/temp |
| File and folder names encrypted in the store (AES-SIV index; opaque `data/` blobs — forensic tools cannot map blobs to logical paths without the password) | Registry metadata still visible (`display_name`, vault folder id) |
| No remember-password on HD except explicit disk memory modes | Compromised host (keylogger) |
| Export streams logical content or copies ciphertext; never stages a decrypted tree | Last write if power loss during write |
| Close + optional `secure_wipe_workspace` (`upriv_plain`) | Old encrypted versions on SSD |
| Swap minimization (RF-51) | 100% anti-swap on all OSes (platform limitation) |

**Encrypted traces on SSD:** do not expose content without the password; old ciphertext versions may remain until rotation — acceptable for confidentiality, document in UI.

**Exception mode `upriv_plain`:** plaintext `workspace/` on HD **while open**; mitigation = UI warning + `secure_wipe_workspace` on close (RF-41–44). Never use that path as a helper for `encrypted_dir`.

### 3.5 Platforms

| Phase | Platforms | Delivery |
|------|-------------|---------|
| **v1 (initial)** | **Linux + Windows** (x86_64; ARM64 if needed) | Electron + Rust; virtual mount — **FUSE** (Linux), **WinFsp** (Windows); embedded `7zz` per OS |
| v1.1 | macOS | Electron; platform virtual mount |
| v2 | Android | React Native + `upriv-core` (Rust); OTG vault; single APK; see §3.6 |
| v3 | iOS | React Native + `upriv-core`; App Store; same vault layout; no APK on HD |

**Note:** **vault format** (`contents/` under `.upriv/vaults/<id>/`) is cross-platform from the start; the **Upriv desktop app** in v1 ships on **Linux and Windows**.

### 3.6 Android — specific requirements

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-A01 | App installed via APK (distributed in `.upriv/app/Android/Upriv.apk` in HD bundle or elsewhere) | P0 |
| RF-A02 | First run: select vault folder via **SAF** (`ACTION_OPEN_DOCUMENT_TREE`); persist URI with `takePersistableUriPermission` | P0 |
| RF-A03 | Identify vault-root by `.upriv/settings.toml`; identify a vault by `.upriv/vaults/<id>/` (`contents/` at rest) | P0 |
| RF-A04 | Workspace `workspace/` created and maintained **on vault volume (OTG HD)**, not only in app internal cache | P0 |
| RF-A05 | Button **`action.open_folder`**: delegate navigation to external file app via `Intent` (chooser); do not implement full file manager in Upriv | P0 |
| RF-A06 | Same open/close/recovery cycle as desktop; `7z t` before writing new `.7z` | P0 |
| RF-A07 | Remember last vault (URI) in phone app config — **outside** vault folder | P1 |
| RF-A08 | Warning on closing app with vault open; recovery if OTG disconnected with `workspace/` present | P1 |
| RF-A09 | Plan B: user-exported `{display_name}.7z` opens with ZArchiver / similar without Upriv (not a rest twin) | P0 |
| RF-A10 | Do not support "portable app" as extracted APK folder on HD (APK → install only) | — |

**Android UX summary**

| Step | Behavior |
|-------|----------------|
| Install | Tap APK → Package Installer → app in launcher |
| Link HD | Once: choose vault root folder in SAF picker |
| Open | Password → extract to `<vault-root>/workspace/` on HD |
| Edit | Upriv or external manager in same `workspace/` folder |
| Close | Recompress and delete `workspace/` on HD |

**Accepted product limitations**

- Not every file manager handles "open in this folder" the same; use `Intent.createChooser` and test common apps.
- Paths are **URIs** (`content://`), not `E:\` — core must abstract file access via SAF.
- iOS: same vault layout, but **no** `app/iOS` binary; app only via App Store (v3 phase).

---

## 3.7 Desktop interface (UX v1 — Linux)

All visible strings use **i18n keys** in `dev/apps/shared/locales/{locale}.json` (default `en`, also `pt-BR` and `es`). See `LOCALE.md`. Buttons and states below map to keys such as `action.lock`, `vault.status.closed`.

General guideline: **simple interface**, **dark theme** by default (`[ui] theme = "dark"` in `main.toml`). No separate welcome screens — on app open, user sees **immediately** the **centered** vault list.

**Brand / logo (wordmark exports):** three fixed colors — white `#FFFFFF`, black `#000000`, navy `#0B0E1E` — as `.svg` / `.png` in `.upriv/app/assets/` (see SDD §8.2.1, `prod/.upriv/app/assets/README.md`).

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
- **`[vault]` in UI:** `display_name`, optional **`order`** (same as drag-and-drop reorder), optional **`note`**. **Not shown:** `id` (folder slug; migrates when display name normalizes).
- **`[security]` in UI:** optional **`password_hint`** (stored in `[vault]` in TOML), **`mode`** (password-memory — same four choices for all storage modes; see §4), **`action.change_password`** (current + new + confirm; **open or closed** vault). **`secure_wipe_workspace`** is edited under the **Close** section. **Not shown in v1:** `wipe_passes`, `wipe_pattern`.
- **`[seven_zip]` in UI:** compression preset (**none / low / medium / high**) + `encrypt_file_names` (`method`/`solid` = defaults; level derived from preset).
- **`[policy]` in UI:** `allow_external_editors` and `disallow_copy_outside_mount` as separate radio groups (four combinations).
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
| RF-UI-08 | **Export** (`action.export_vault`) from the overflow menu. User chooses `.zip` of `contents/` (Recommended) or `.7z` | P0 |
| RF-UI-09 | Row buttons do not propagate click to row (stop propagation) | P0 |
| RF-UI-10 | Transient screens: unlock (password), recovery; open/close progress on the **row** (and unlock/lock dialog while open) with a finite time budget — **no** blocking full-screen pipeline overlay. Lock confirmation: **`always_prompt`** (password **presence** check, not a second Argon2) and **`upriv_plain`** (wipe). Default `encrypted_dir` lock starts the close pipeline immediately. **One pipeline at a time** — open/close/create are **queued** (FIFO); no cancel mid-flush | P0 |
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

## 4. Password/session security modes

Configurable in `config/<id>.toml` as `security.mode`.

Close uses **session keys** already in RAM (or `session.enc`). It does **not** re-encrypt `contents/` with a newly typed password. Change password is a separate flow.

| Mode | ID | Summary behavior |
|------|-----|------------------------|
| 1 — Opt-in | `always_prompt` | Prompt on open **and lock** as a presence check against the open session; do not retain the password **string** in RAM. Session keys still stay in RAM while the vault is open. Typed close password must **not** rewrap `vault.header`. Idle auto-close cannot run (would need a prompt). |
| 2 — Default | `session_ram` | One password per session in RAM; **lock does not ask again**; after reboot prompt again |
| 3 — Legacy | `ram_on_close_only` | Deprecated (was for `.7z` re-pack on close). Load/save **rewrites to `session_ram`**. Not shown in the UI. |
| 4 | `disk_close` | `session.enc` on disk to lock without retyping; open always prompts |
| 5 — Less secure | `disk_open_close` | `session.enc` to open and close without retyping |

**Recommended default:** `session_ram` (mode 2).

**v1 desktop UI:** four password-memory choices for **all storage modes** — **`session_ram`** (recommended), **Never save** (`always_prompt`; more-secure badge — presence check on lock), **`disk_close`** (less secure), **`disk_open_close`** (insecure). Disk modes only affect how the **unlock password** is retained via `auth/<id>/.session.enc`.

**Global rule:** no mode writes password in plaintext in the vault.

**Defaults and warnings:**

- **Default:** `session_ram` — password in RAM until app exit or vault lock; lock uses that session.
- **RAM capacity:** show **`warning.encrypted_dir_ram`** when `encrypted_dir` (settings + create wizard). Insufficient memory → open/edit/close may fail (no silent spill to plaintext disk).
- **`upriv_plain`:** show **`warning.upriv_plain`** (plaintext while open); radio badge **insecure**. Lock shows a wipe confirmation (no password unless `always_prompt`).
- **Disk session modes** are optional user choices (badges less-secure / insecure); `session.enc` holds an **encrypted session key**, not the password string.
- Hide **Close → keep encrypted cache** in settings; lock always **closes** (no Seal). See RF-53c.

---

## 5. Vault structure (product contract)

```
<vault-root>/
├── workspace/                     # Open vaults — demo: all 3 examples
│   ├── exemplo-1/
│   ├── exemplo-2/
│   └── exemplo-3/
├── Upriv-windows.exe
├── Upriv-mac
├── Upriv-linux
└── .upriv/
    ├── config/
    │   ├── main.toml              # [package], [ui], [app]
    │   ├── exemplo-1.toml         # [vault] id, display_name
    │   ├── exemplo-2.toml
    │   └── exemplo-3.toml
    ├── vaults/
    │   ├── exemplo-1.7z
    │   ├── exemplo-2.7z
    │   └── exemplo-3.7z
    ├── backup/                    # snapshot on close (keep_last / keep_all)
    │   ├── exemplo-1/
    │   └── exemplo-3/
    ├── auth/                      # passwords / session per vault
    │   ├── exemplo-1/
    │   └── exemplo-2/
    ├── runtime/
    │   └── state.json             # open vaults (demo: all 3)
    └── app/
        ├── assets/Upriv.svg
        ├── Windows-x64/
        ├── Linux-x64/
        ├── macOS-arm64/
        └── Android/Upriv.apk
```

**Clean root:** user sees `workspace/` + **3 launchers** (`Upriv-windows.exe`, `Upriv-mac`, `Upriv-linux`); everything else under `.upriv/`.

**Desktop:** working folder = contains `.upriv/settings.toml` (`--vault <vault-root>`).

**Android:** vault identified by **SAF URI** of root folder; app installed separately from APK.

---

## 6. Non-functional requirements

| ID | Requirement |
|----|-----------|
| RNF-01 | Typical vault (passwords/docs): open/close in seconds to a few minutes |
| RNF-02 | Comfortable size per vault: up to ~1 GB uncompressed; up to ~3 GB with care on desktop |
| RNF-03 | Single executable per OS (Electron); `7zz` as bundled dependency |
| RNF-04 | UTF-8 config, paths relative to vault root |
| RNF-05 | Core code in Rust (`upriv-core`); desktop UI React web + Electron; mobile UI React Native + Rust FFI (later phases). UI layers are presentation only — crypto, RAM session, and disk I/O live in Rust. See `ARCHITECTURE.md` |
| RNF-05b | **v1:** desktop app **Linux + Windows**; vault format and `.7z` portable from the start |
| RNF-06 | License and dependencies compatible with `7zz` distribution |

---

## 7. Success metrics (MVP)

- User creates vault, adds files, closes and reopens on another PC with same `.7z`.
- After simulating crash (orphan workspace), recovery closes vault without corrupting `contents/`.
- Wrong password on lock (`always_prompt` presence check) **does not** change `contents/`.
- Opening an exported `{display_name}.7z` with external 7-Zip works with same password.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|-------|-----------|
| `.7z` ↔ store desync | `manifest` + RF-47–48; recovery with authority rule (§3.4) |
| User ejects HD with vault open | Warning + recovery; lockfile; encrypted store preserves data |
| Wrong password after reboot | Mandatory `7z t` before write |
| Corruption on close | `.7z.new` + test + optional `backup/` |
| Poorly implemented virtual workspace | RF-49 + integration tests |
| `7zz` temp | RF-50 (stream + tmpfs) |
| Swap leaks session | RF-51 (minimize; document limit) |
| External apps create copies | RF-52 (warnings + optional restricted mode) |
| Encrypted traces / old versions | `full` close + wipe (RF-53); accept in `normal` close |
| Two PCs on same USB | RF-54 lockfile + warning |
| 7z on PATH vs bundled | Bundle `7zz` per platform in app/HD |
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
- `encrypted_dir` flow: `contents/` → virtual `workspace` → close → flush `contents/`
- `upriv_plain` flow: `contents/` → plaintext `workspace` → close → `contents/` + wipe workspace
- Compression presets on close (none/low/medium/high → RF-31b)
- `settings.toml` + defaults
- Basic recovery + `manifest` (RF-47–48)
- States `open` / `closed`
- RAM-only session; no password persistence on HD
- Virtual mount + anti-plaintext tests (RF-49)
- Vault list UI + dark theme (RF-UI-01–10; §3.7)

### v0.2
- Backup in `backup/<id>/` (`keep_last` / `keep_all`)
- 4 security UI modes + `session.enc` (opt-in disk modes); legacy `ram_on_close_only` rewritten to `session_ram`
- Settings UI

### v0.3
- macOS (v1.1)

### v0.4 — Android
- React Native + `upriv-ffi` (UniFFI); single APK bundles UI, bridge, and `libupriv_ffi.so`
- SAF: link vault folder on OTG HD
- Workspace `workspace/` on HD (desktop parity)
- Open/close vault; OTG recovery
- Button `action.open_folder` → Intent to external manager
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
| **`contents`** | — | Ciphertext at rest | `vaults/<id>/contents/` |
| **`session`** | `layer.session` | Active logical view (mount + RAM) | virtual `workspace/<id>/` |
| **`plain`** | `layer.plain` | `upriv_plain` only: files in plaintext on disk while open | real `workspace/<id>/` |

Open: **`contents` → `session`** (or **`plain`**). Close: flush back to **`contents`**.

`storage.mode` in TOML:

| `storage.mode` | Layers used |
|----------------|----------------|
| `encrypted_dir` | `contents` + `session` (default) |
| `upriv_plain` | `contents` + `plain` |

Suggested Rust modules: `upriv_core::store`, `::session`, `::plain`.

### 11.2 Glossary

| Term | Definition |
|-------|-----------|
| Vault / vault-root | Folder `<vault-root>` with standardized layout (not the vault itself) |
| **`contents`** | Ciphertext at rest — `vaults/<id>/contents/` |
| **`session`** | Virtual mount + keys in RAM (`encrypted_dir`) |
| **`plain`** | Plaintext workspace on disk while `upriv_plain` is open |
| Close vault | Flush session into `contents/` → unmount → zeroize RAM |
| `open` | Active `session` (runtime) |
| `closed` | `contents/` at rest |
| Export | Separate action: `.zip` of `contents/` (Recommended) or `.7z` |
| SAF | Storage Access Framework (Android) |
| Vault URI | `content://` reference to vault root on Android |

---

*Document intended to align implementation (see SDD.md) and onboarding of other AIs or developers.*
