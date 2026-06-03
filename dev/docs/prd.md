# PRD — Upriv

**Language:** English (UI copy: `dev/docs/i18n/` — see `LOCALE.md`)

**Product Requirements Document**  
**Version:** 0.2  
**Date:** 2026-05-31  
**Status:** Draft for implementation kickoff  
**Companion:** `sdd.md`, `ARCHITECTURE.md`

---

## 1. Product vision

### 1.1 What it is

Upriv is a **portable vault manager** based on **AES-256 encrypted `.7z`** as the closed/portable container, with a **mountable encrypted store** for live editing without persisting plaintext on the HD/SSD.

**v1 (initial goal):** implement the secure flow (`encrypted_dir`) **on Linux only** (desktop) first. The alternative mode with a plaintext workspace on the HD (`plain`) **will be implemented later** for exceptional cases (e.g. insufficient RAM, very large vault), not discarded. Windows, macOS, and mobile are deferred to later phases (§3.5).

The user opens with a password, edits in `workspace/{display_name}/` (virtual mount / RAM), the encrypted store in `.upriv/vaults/<vault_id>/store/` stays on disk, and on app close a new `.7z` is generated in `vaults/<vault_id>/archive/`.

Differentiators vs. manual 7-Zip use:

- Guided flow: **Open vault → Work → Close vault**
- **Standardized** vault-oriented layout (`.upriv/settings.toml`, `vaults/<vault_id>/` per vault — see `prod/README.md`)
- Works on **external HD, local system folder, or synced cloud** (as long as the vault is a folder)
- **Plan B:** without the app, the same `.7z` opens in 7-Zip, PeaZip, ZArchiver, etc.
- Recovery after failure (USB eject, crash, reboot with vault open)

### 1.2 Problem it solves

| Problem | Upriv solution |
|----------|-----------------|
| LUKS / BitLocker don't open on all devices | Universal `.7z` container |
| Cryptomator: proprietary format; paid mobile | `.7z` + Android app (APK on HD or installed); iOS in a later phase |
| Manual 7-Zip: easy to forget to recompress; plaintext folder on HD | Encrypted store + virtual workspace; `.7z` only on close |
| Passwords/sensitive files on exFAT without encryption | One `.7z` per vault with a strong password |
| Multiple PCs / HD / local folder | Same vault layout anywhere |

### 1.3 Target audience

- Technical or semi-technical users who store **passwords, documents, keys, exports** (not focused on huge videos/VMs).
- Wants **one place** (HD or folder) with strong encryption and access on **Windows, Linux, Mac** (Android/iOS in later phases).
- Values **app independence** (7z format) and ease of use.

### 1.4 Non-goals (v1)

- **Non-Linux clients** — Windows, macOS, Android, and iOS are not in the first release; vault layout and `.7z` remain portable (Plan B on any OS).
- Replace cloud password manager (Bitwarden, etc.) — can **store** exports inside the vault.
- Full-partition encryption (LUKS/VeraCrypt).
- Proprietary vault format without export to `.7z`.
- Monolithic vaults of tens of GB (supported with limitations, not recommended).
- Replace full-disk encryption at OS/firmware level.
- Implement `plain` in the **same product** (v1.1+), not as "abandoned legacy" — see §1.6.

### 1.6 Two storage modes (full product)

| Mode | ID | When to use | v1 |
|------|-----|-------------|-----|
| **Secure (default)** | `encrypted_dir` | Normal use; minimize plaintext traces on HD/SSD | **Yes** |
| **Exception** | `plain` | Insufficient RAM, weak hardware, huge vault, or explicit user fallback | **No** (planned v1.1+) |

`plain` flow: `.7z` → extract to `workspace/<id>/` **in plaintext** on the HD → edit → close → new `.7z` + `secure_wipe_workspace`. Less secure (SSD wipe limitations); simpler and more predictable in memory.

The user chooses the mode in `config/<id>.toml` (`storage.mode`); the UI must warn when selecting the exception mode.

### 1.7 Vault states (unified across modes)

**Rule:** **persisted state** depends on what exists on disk, not on `storage.mode`. When **only `.7z` exists**, both modes have the **same** state.

| State (ID) | UI (i18n) | What exists on HD | `encrypted_dir` | `plain` |
|-------------|---------|-------------------|-----------------|------------------|
| **`open`** | `vault.status.open` | `.7z` + active working data | encrypted store + virtual mount | `workspace/` in plaintext |
| **`closed`** | `vault.status.closed` | `.7z` + **encrypted local cache** | `stores/<id>/` kept | *not applicable* |
| **`sealed`** | `vault.status.sealed` | **Only** `.7z` (+ backups, config) | after sealed close (wipe store) | after normal close (wipe workspace) |

```text
encrypted_dir:   sealed ──open──► open ──close──► closed ──seal──► sealed
                      ▲                    └──seal (direct)──┘

plain:  sealed ──open──► open ──close──► sealed
```

- **`closed`** exists **only** in `encrypted_dir` (fast reopen without re-importing from `.7z`).
- **`sealed`** is **the same in both modes**: maximum portability, direct Plan B; reopen materializes again.
- Implementation transients: `closing`, `recovery` (not "at rest" UI states).

**"Real" states (not just folder presence):**

| State | Required condition |
|--------|----------------------|
| **`open`** | **Runtime only:** active lock + active virtual mount + session key in RAM. Folders on disk are **not** sufficient. |
| **`closed`** | `.7z` + encrypted `stores/<id>/` + `manifest.persistence == "closed"` + **`sync_generation` aligned** (see §3.4) + `last_store_write_at <= last_close_ok_at` + integrity hashes match disk. |
| **`sealed`** | Valid `.7z` only + `manifest.persistence == "sealed"` (or no store after wipe) + no active session. |

**Important:** `archive_hash` ≠ `store_hash` (different formats). **Never** compare one with the other for "in sync". Sync = same **`sync_generation`** + OK close timestamps.

**Detection on startup (per vault):**

| Situation | Result |
|----------|-----------|
| Active lock + mount | `open` |
| Store + `.7z` but `last_store_write_at > last_close_ok_at` or `sync` misaligned | **`recovery`** (do not show `closed`) |
| Store + `.7z` + manifest `closed` + sync OK + hashes OK | `closed` |
| Only `.7z` (no store); optional `vaults/<id>.meta.json` with `persistence: sealed` | `sealed` |
| Orphan without lock | `recovery` |

### 1.9 v1 flow (single mode — initial goal)

Agreed pipeline for the first release:

| Step | What |
|-------|--------|
| 1 | **Open:** read `vaults/<id>.7z` and **materialize** encrypted store in `.upriv/stores/<id>/` on HD/SSD (no persistent plaintext). |
| 2 | **Session:** mount virtual `workspace/<id>/`; plaintext content only in **RAM/cache** for viewing and editing. |
| 3 | **Edit:** each save updates the logical view **and** persists to the encrypted store (`.enc` blobs on disk). |
| 4 | **Close:** `7z t` on the **original** `.7z` with password kept in RAM — failure aborts everything. |
| 5 | **Close:** generate `vaults/<id>.7z.new` from the session's **logical content** (stream to `7zz`, no plaintext temp on disk). |
| 6 | **Close:** test `.7z.new` → atomic rename → backup or replace old `.7z` per `[backup]`. |
| 7 | **Close:** unmount `workspace/<id>/`, zero password/keys in RAM. Action `close` → state **`closed`**; action `seal` → state **`sealed`** (§1.7). |

**Accepted trade-off (v1):** after reboot, the user **must re-enter the password** to mount again. No "remember password" on HD/SSD in this mode.

**Data after reboot:** not lost — the encrypted store in `.upriv/stores/<id>/` already contains changes; only unlock/mount is needed.

### 1.8 Technical mitigations (architecture)

| # | Risk | Product mitigation |
|---|--------|----------------------|
| 1 | `.7z` and encrypted store out of sync | Per-vault `manifest`: `sync_generation`, hashes, timestamps; authority rule (§3.4) |
| 2 | Partial copy (only `.7z` or only `stores/<id>/`) | On `open`, compare manifest; UI: use store, reimport `.7z`, or compare |
| 3 | Direct writes to `workspace/` on HD | **Virtual** mount (FUSE/WinFSP): I/O → encrypt → `stores/<id>/`; tests that forbid persistent plaintext |
| 4 | `7zz` temp when exporting `.7z` | Stream logical content; `7zz` temp in `tmpfs`/`noswap` when available; clean up at end |
| 5 | Swap/hibernation | **Minimize** swap of sensitive buffers (`mlock`, RAM buffers); do not promise 100% on all OSes |
| 6 | External apps (Word, etc.) | Editing via mount allowed; warn about copies in `%TEMP%`; "internal editor only" option for critical files |
| 7 | Encrypted traces on SSD | Acceptable for confidentiality; **full** close wipes store (§3.4) |
| 8 | Two PCs on same HD | `runtime/<id>.lock` + warning; simultaneous use remains user responsibility |
| 9 | `plain` mode | Strong UI warning; wipe on close (documented SSD limits) |
| 10 | Custom crypto | Standard primitives (Argon2id + AEAD); universality/portability via **`.7z`** |
| 11 | Old backups | UI: list/view/restore `backup/<id>/*.7z` per vault |

**Store encryption:** use the most mature and auditable libraries and formats possible (do not reinvent AEAD/KDF). Plan B and backups remain in **7z**.

---

## 2. Main use cases

### UC-0 — Create new vault (from scratch, not import)

1. User clicks **`app.new_vault`** on the vault list screen.
2. Enters **`display_name`** (validated per RF-15b).
3. Enters **password** and **confirm password** (required; must match).
4. Optionally enters a **password hint** (reminder only — not the password).
5. Optionally enters a short **vault note** (simple annotation for the user).
6. App creates `vaults/<vault_id>/` layout, writes `config.toml` (including hint/note if provided), and generates the first `archive/{display_name}.7z` with the chosen password.
7. Vault opens (or appears in list as `closed`/`sealed` per close policy).

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

1. User copies only `.upriv/vaults/<id>.7z`.
2. Opens with 7-Zip + password (documented in `README.md` at vault root if needed).

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
| RF-01 | Create new vault (`vaults/<vault_id>/` layout + `.upriv/settings.toml` + first `archive/<display_name>.7z`) | P0 |
| RF-01b | **Create-new wizard (not import):** require password + confirm password; optional **password hint** field | P0 |
| RF-01c | **Vault note:** optional short user annotation per vault; editable in create wizard and vault settings | P1 |
| RF-01d | Store `password_hint` and `note` in **`config.toml` `[vault]`** — not in `persistence.json`, not a separate notes file (v1) | P0 |
| RF-02 | Open vault (`encrypted_dir` default): validate password, mount virtual `workspace/<id>/`, load encrypted store | P0 |
| RF-03 | Expose `workspace` to user (button `action.open_folder` → OS file manager) | P0 |
| RF-04 | Close vault (`encrypted_dir`): unmount `workspace/<id>/`, clear session keys; keep encrypted persistence | P0 |
| RF-04b | `plain` mode (`.7z` → plaintext workspace → `.7z` + wipe): implement **after v1** for exceptional cases (RAM/large vault); UI with security warning | P1 |
| RF-05 | On close: **before** backup or compress, `7z t` on existing `vaults/<id>.7z` with given password — failure aborts everything (prevents closing with password different from opened vault) | P0 |
| RF-06 | Atomic write: `<id>.7z.new` → test → rename → delete old | P0 |
| RF-07 | Backup on close: move `vaults/<id>.7z` to `backup/<id>/<timestamp>-<id>.7z` if `[backup] enabled` | P1 |
| RF-07b | Modes: `keep_last` (only latest backup) or `keep_all` (history) | P1 |
| RF-08 | Recovery UI if workspace/marker exists with vault logically "closed" | P0 |
| RF-09 | Open existing vault via `--vault <path>` or dialog | P0 |
| RF-10 | Remember last vault in app profile (outside vault folder) | P2 |
| RF-11 | **Multiple vaults** per HD: one `.toml` + encrypted store per vault (and optional `.7z` per vault) | P1 |
| RF-12 | Virtual workspace = `workspace/<id>/` where `<id>` = `[vault] id` in TOML | P0 |
| RF-13 | Discover vaults by listing `config/*.toml` (filename / `id` field) | P0 |
| RF-14 | Open/close vaults **independently** (several open at once) | P1 |
| RF-15 | **Unique `vault_id`:** normalized slug for `vaults/<vault_id>/`; `display_name` for UI / main `.7z` / `workspace/` | P0 |
| RF-15b | **Validate `display_name`:** reject `\ / : * ? " < > \|`, controls, empty, trailing space/`.`, reserved Windows stems, length > 128; allow Unicode accents and spaces | P0 |
| RF-15c | **`vault_id` slug:** normalize from `display_name` (lowercase, spaces→`-`, strip forbidden, optional accent fold); max 64 chars; collision suffix | P0 |
| RF-15d | **Export `.7z`:** default `{display_name}.7z`; if save path invalid, block or minimal sanitize filename only; source `display_name` unchanged | P1 |
| RF-15e | **Import `.7z` → new vault:** stem → `display_name`; if invalid, dialog with `sanitize_minimal` pre-fill + user confirm; copy to `archive/{display_name}.7z` | P0 |
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
| RF-58 | **Change password** (vault settings / `[security]`): require current password + new password + confirm; re-encrypt main archive and encrypted store | P1 |
| RF-59 | On change password: **warn** that existing files in `backups/` remain encrypted with the **previous** password(s); only the main archive (and future backups) use the new password | P1 |
| RF-25 | **Vault config editable at any time** (app UI or edit `config/<id>.toml`) — not a "create and never change" model | P0 |
| RF-26 | App **reloads** TOML on startup, on vault focus, and when file changes (idempotent reload) | P0 |
| RF-27 | Changes to `[seven_zip]`, `[backup]`, `[auto_close]`, `[security]` apply on **next** relevant cycle (close/open), with UI warning if vault is open | P0 |
| RF-28 | Changing `id` or `vault_file` requires **explicit migration** (vault closed); silent rename forbidden with open workspace | P1 |

**Product principle:** creating a vault defines initial layout; **all behavior options** (`archive_mode`, backup, auto-close, session, etc.) remain **reconfigurable** for the vault's lifetime.

### 3.3 Security and UX

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-30 | Password in RAM during session (default mode); zero on close | P0 |
| RF-31 | Conservative 7z parameters in both modes: `-mhe=on`, AES-256, `-ms=off` | P0 |
| RF-31b | Per vault: `archive_mode` — **default `encrypt_only`**; optional `compress_encrypt` | P1 |
| RF-32 | Warning on exit with vault open | P1 |
| RF-33 | Session security levels (5 modes) — see SDD | P2 |
| RF-34 | `session.enc` for disk modes (encrypted session key, not password) | P2 |
| RF-34b | In `encrypted_dir` (most secure mode), **forbid** password/session persistence on HD/SSD (`session.enc`, `quick-auth`) and hide "remember password" option in UI | P0 |
| RF-35 | **Auto-close per vault:** `[auto_close]` in `config/<id>.toml` | P1 |
| RF-36 | Auto-close after `idle_minutes` without activity on open vault | P1 |
| RF-37 | Activity = app UI + changes in `workspace/<id>/` (virtual filesystem watch) | P1 |
| RF-38 | Optional `warn_before_seconds` warning before auto-close | P2 |
| RF-39 | Auto-close uses same v1 `close()` flow (7z t → `.7z.new` → unmount → zeroize) | P0 |
| RF-40 | Global default: `enabled = false` if section missing | P0 |
| RF-41 | **`secure_wipe_workspace`** (`plain` mode): on close/discard, overwrite plaintext files before delete | P1 |
| RF-42 | Default `secure_wipe_workspace = true` in exception mode; configurable `wipe_passes` (1–3 on HD) | P1 |
| RF-43 | Wipe also on recovery **DiscardWorkspace** in exception mode | P1 |
| RF-44 | Document limit: SSD/flash **do not** guarantee physical wipe in exception mode | P1 |
| RF-45 | (`encrypted_dir`) When generating `.7z` on close, use **logical content stream** (do not pack `.enc` blobs; no plaintext temp) | P0 |
| RF-46 | (`encrypted_dir`) After reboot: reopen requires password; data preserved in encrypted store `stores/<id>/` | P0 |
| RF-47 | **`persistence.json`** per vault (`.upriv/vaults/<vault_id>/persistence.json`): `sync_generation`, store hash, `.7z` hash, last OK close timestamp | P0 |
| RF-48 | On `open`, if manifest indicates `.7z`/store divergence: UI with **`recovery.use_store`**, **`recovery.reimport_archive`**, or **`recovery.compare`** (no silent overwrite) | P0 |
| RF-49 | `workspace/<id>/` in `encrypted_dir` is **virtual mount only** — forbid plaintext persistence on HD; automated tests | P0 |
| RF-49b | **Write-through:** every committed write via mount persists immediately to encrypted store (`stores/<id>/`); what user saves in session is not "RAM only" | P0 |
| RF-50 | Export `.7z`: mitigate `7zz` temp (stream, temp in `tmpfs` if available, post-export cleanup) | P1 |
| RF-51 | **Minimize swap** of session data buffers (`mlock` / per-OS policies where supported) | P1 |
| RF-52 | **External editor policy:** allow editing via mount; warn temp-outside-vault risk; option to restrict to integrated editor | P1 |
| RF-53 | **`encrypted_dir` close:** `close` → **`closed`**; `seal` → **`sealed`** (wipe store). **`plain` close:** only `seal` → **`sealed`** | P0 |
| RF-53b | **`manifest` / `vaults/<id>.meta.json`:** `persistence: "closed" \| "sealed"` only (never `open`). **`state.json`:** `session: "open" \| "closing" \| "recovery"`. UI `vault.status.open` = runtime only | P0 |
| RF-53c | On **close** in `encrypted_dir`, UI asks: **`action.close`** (becomes `closed` — encrypted cache + `.7z`, fast reopen) or **`action.seal`** (becomes `sealed` — compact `.7z` only). In `plain`, only **`action.seal`** (no `closed` option) | P0 |
| RF-54 | **Lockfile** `runtime/<id>.lock` on vault open; refuse second open in another process/PC | P1 |
| RF-55 | Crypto primitives: Argon2id + AEAD (e.g. XChaCha20-Poly1305); protected names/paths | P0 |
| RF-56 | **Backups** UI per vault: list `backup/<id>/*.7z`, metadata, restore/replace, open with password | P1 |
| RF-57 | **Real states:** `open` only with active session; `closed` only with `sync_generation` + timestamps + integrity hashes; never `archive_hash == store_hash` | P0 |

### 3.4 `.7z` ↔ store sync (`manifest`)

Per-vault manifest file (example):

```json
{
  "sync_generation": 42,
  "archive_hash": "sha256:…",
  "store_hash": "sha256:…",
  "last_close_ok_at": "2026-05-28T14:00:00Z",
  "last_store_write_at": "2026-05-28T14:00:00Z",
  "persistence": "closed"
}
```

| Field | Purpose |
|-------|--------|
| `sync_generation` | Unique counter: increments on **each OK close**; `.7z` and store share the **same generation** |
| `archive_hash` | Integrity of `vaults/<id>.7z` file (always different from `store_hash`) |
| `store_hash` | Integrity of encrypted tree (`index/` + `data/`) — **do not** compare with `archive_hash` |
| `last_close_ok_at` | When `.7z` and store were **aligned** last |
| `last_store_write_at` | Last store write; during `open` runs **ahead of** `last_close_ok_at` |

**`closed` is true only if:**

1. `persistence == "closed"`
2. `stores/<id>/` and `vaults/<id>.7z` exist
3. `last_store_write_at <= last_close_ok_at` (nothing edited since last close)
4. current `archive_hash` == manifest
5. current `store_hash` == manifest
6. (Optional) `archive_mtime` ≈ `last_close_ok_at` — detect externally replaced `.7z`

**During `open`:** each write-through updates `last_store_write_at`; UI state = **`vault.status.open`** (runtime). Vault **stops being `closed`** while unclosed edits exist.

**After OK `close` close:** `sync_generation++`; recalculate both hashes; `last_close_ok_at = now`; `last_store_write_at = last_close_ok_at`.

**Rules:**

| Situation | State / action |
|----------|----------------|
| Active session (lock + mount) | `open` (runtime) |
| OK `close` close | `closed` if conditions above |
| OK `seal` close | `sealed`; delete store |
| `last_store_write_at > last_close_ok_at` without session | **recovery** — store ahead of `.7z` |
| `.7z` replaced (hash or mtime) | **recovery** — offer reimport (RF-48) |
| `sync_generation` misaligned | **recovery** — explicit UI |

**Sealed close (`seal`):** after `.7z` validated, wipe local cache (`stores/<id>/` or plaintext `workspace/`); `persistence = sealed` — **identical in both modes** when only the file remains.

### 3.3.1 Threat: sensitive traces on disk (v1 / exception mode)

While vault is **open**, plaintext exists in **session** (RAM / virtual mount). On HD/SSD only encrypted store persists and, after successful close, updated `.7z`.

| Mitigated in v1 | Outside app control |
|----------------|-------------------------|
| No persistent plaintext workspace in vault | OS swap/hibernation |
| Store `stores/<id>/` always encrypted | External app cache/temp |
| No `session.enc` / remember password on HD | Compromised host (keylogger) |
| Export `.7z` by stream, not plaintext temp | Last write if power loss during write |
| `sealed` close + store wipe | Old encrypted version traces on SSD (`closed` state) |
| Swap minimization (RF-51) | 100% anti-swap on all OSes (platform limitation) |

**Encrypted traces on SSD:** do not expose content without password; old encrypted versions may exist until `full` close or rotation — acceptable for confidentiality, document in UI.

**Exception mode `plain`:** plaintext workspace on HD between open and close; mitigation = `secure_wipe_workspace` (RF-41–44) + mode selection warning; SSD limits documented.

### 3.5 Platforms

| Phase | Platforms | Delivery |
|------|-------------|---------|
| **v1 (initial)** | **Linux** (x86_64; ARM64 if needed) | Tauri 2 + Rust + FUSE; virtual mount; embedded `7zz` for Linux |
| v1.1 | Windows | Tauri + WinFSP (or equivalent) for `session` |
| v1.2 | macOS | Tauri; virtual mount on macOS |
| v2 | Android | React Native + `upriv-core` (Rust); OTG vault; single APK; see §3.6 |
| v3 | iOS | React Native + `upriv-core`; App Store; same vault layout; no APK on HD |

**Note:** **vault format** (`.7z`, `.upriv/`, `manifest`) is cross-platform from the start; only the **Upriv app** in v1 runs on Linux.

### 3.6 Android — specific requirements

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-A01 | App installed via APK (distributed in `.upriv/app/Android/Upriv.apk` in HD bundle or elsewhere) | P0 |
| RF-A02 | First run: select vault folder via **SAF** (`ACTION_OPEN_DOCUMENT_TREE`); persist URI with `takePersistableUriPermission` | P0 |
| RF-A03 | Identify vault by presence of `.upriv/settings.toml` + at least one `.upriv/vaults/<id>.7z` | P0 |
| RF-A04 | Workspace `workspace/` created and maintained **on vault volume (OTG HD)**, not only in app internal cache | P0 |
| RF-A05 | Button **`action.open_folder`**: delegate navigation to external file app via `Intent` (chooser); do not implement full file manager in Upriv | P0 |
| RF-A06 | Same open/close/recovery cycle as desktop; `7z t` before writing new `.7z` | P0 |
| RF-A07 | Remember last vault (URI) in phone app config — **outside** vault folder | P1 |
| RF-A08 | Warning on closing app with vault open; recovery if OTG disconnected with `workspace/` present | P1 |
| RF-A09 | Plan B: open `vaults/<id>.7z` with ZArchiver / similar without Upriv | P0 |
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

All visible strings use **i18n keys** in `dev/docs/i18n/{locale}.json` (default `en`, also `pt-BR`). See `LOCALE.md`. Buttons and states below map to keys such as `action.lock`, `vault.status.sealed`.

General guideline: **simple interface**, **dark theme** by default (`[ui] theme = "dark"` in `main.toml`). No separate welcome screens — on app open, user sees **immediately** the **centered** vault list.

**Brand / logo (wordmark exports):** three fixed colors — white `#FFFFFF`, black `#000000`, navy `#0B0E1E` — as `.svg` / `.png` in `.upriv/app/assets/` (see SDD §8.2.1, `prod/.upriv/app/assets/README.md`).

### 3.7.0 Design baseline (not final UI)

A **visual and interaction baseline** lives in **`dev/docs/stitch_upriv_vault_manager/`** (Stitch export). It is a **starting-point reference only** — **not** the approved final interface and **not** a substitute for this section or the SDD.

| Artifact | Role |
|----------|------|
| `code.html` | Static HTML prototype (vault list, row states, modal sketches) — preview in browser only |
| `screen.png` | Screenshot of the prototype |
| `DESIGN.md` | Extracted tokens and “Calm Security” style notes |
| `README.md` | Scope, status, and how to use the folder |

**Authority for shipped UI:** requirements in **§3.7** (this document), **SDD §8.2**, and **`dev/docs/i18n/`** (all user-visible copy via keys — see `LOCALE.md`). The baseline may diverge (colors, typography, missing flows, hardcoded English). Gaps in the prototype are expected; implementation must follow PRD/SDD/i18n, not copy `code.html` verbatim.

### 3.7.1 Main screen — vault list

Each vault is a **row** with:

Vault rows are ordered by **`[vault] order`** in `config.toml` (ascending; lower = higher on screen). Vaults without `order` appear after those with an explicit value; tie-break by `display_name`.

**Changing order (UI):**

1. **Vault settings** (`action.settings`): edit **`order`** in the `[vault]` section (numeric field); save writes `config.toml`.
2. **Drag-and-drop (preferred):** on the vault list, **press and hold** a row (or its drag handle), then **drag up or down** to the desired position. On drop, the app reassigns `order` on all affected vaults and persists to each `config.toml` (atomic write). List updates immediately.

Drag must not trigger row click (open workspace) or action buttons — use a dedicated grab zone on the left (e.g. `⋮⋮` handle beside the status dot) or long-press on the name area; action buttons keep `stopPropagation`.

| Zone | Content |
|------|----------|
| **Left** | Vault name + **status dot** (color per `open` / `closed` / `sealed` / `recovery`) |
| **Right** | Action buttons (order below) |

**Button order (left → right in right area):**

1. **`action.backups`** — opens vault backup list modal.
2. **`action.settings`** — opens modal with all vault-specific settings (includes delete vault; see §3.7.3).
3. **`action.lock` / `action.unlock`** — **larger, more prominent** button (primary visual of row). `action.unlock` when closed/sealed; `action.lock` when open (starts close).
4. **`action.seal` (dropdown)** — only when `storage.mode = encrypted_dir` and vault **open**: **down arrow** icon attached to close button, opens menu with **`action.seal`** option (in addition to normal close **`action.close`** → `closed` state). In `plain`, do not show this control (seal only on close).

**Row click (outside buttons):**

- Vault **`open`:** open **workspace** directory in OS file manager (`xdg-open` on Linux).
- Vault **`closed` / `sealed`:** do not open folder; unlock via **`action.unlock`** button (prompts password).

**Row background / outline color** by persisted or runtime state:

| State | Visual feedback (suggestion) |
|--------|----------------------------|
| `open` | Highlight (e.g. border or background with green/teal tone) |
| `closed` | Neutral (base dark theme) |
| `sealed` | More subdued (e.g. soft gray or amber) |
| `recovery` | Warning (e.g. orange/red) until resolved |

Left dot uses **same color semantics** as row outline.

### 3.7.2 Modal — backups

Opened by **`action.backups`** on vault row.

- Lists each file in `backup/<id>/` (name, date, optional size).
- Each row: **name**, **date**, **`action.delete`** button.
- **Delete backup:** confirmation with text field — user must **type vault name** (`id`) to enable delete button.
- Future actions (restore, open with 7-Zip) may join same list; v1 minimum = list + delete with confirmation.

### 3.7.3 Modal — vault settings

Opened by **`action.settings`** on vault row.

- Edits **all** vault-specific configuration (`config/<id>.toml` — `[vault]`, `[storage]`, `[backup]`, `[seven_zip]`, `[auto_close]`, `[security]`, etc.). UI mirrors TOML (RF-UI-04).
- **`[vault]` fields:** `display_name`, optional **`order`** (list display order — numeric; same value as drag-and-drop reorder), optional **`password_hint`**, optional **`note`** (short text, max 256 chars).
- **`[security]` section:** **`action.change_password`** — current + new + confirm; shows **`warning.password_change_backups`** before confirm.
- **`modal.settings.danger_zone` section:** **`modal.settings.delete_vault`** — confirmation with text field; user must **type vault name** (`id`) to confirm deletion (removes `.7z`, store, config entries, and backups per policy).

### 3.7.4 Interface requirements (RF-UI)

| ID | Requirement | Priority |
|----|-----------|------------|
| RF-UI-01 | Dark theme by default; simple layout | P0 |
| RF-UI-02 | Initial screen = centered vault list (no separate welcome) | P0 |
| RF-UI-03 | Row: name + status dot; row color by `open`/`closed`/`sealed`/`recovery` | P0 |
| RF-UI-04 | Per-vault settings modal (TOML); delete vault with name confirmation | P0 |
| RF-UI-05 | Backups modal; delete backup only after typing vault `id` | P0 |
| RF-UI-06 | Prominent Lock/Unlock button (larger visual weight than others) | P0 |
| RF-UI-07 | Row click (outside buttons) opens workspace when `open` | P0 |
| RF-UI-08 | **`action.seal` dropdown** beside close, only `encrypted_dir` + open vault | P0 |
| RF-UI-09 | Row buttons do not propagate click to row (stop propagation) | P0 |
| RF-UI-10 | Transient screens: unlock (password), recovery, closing (progress) overlaid or in modal flow | P0 |
| RF-UI-11 | **Create vault** modal/wizard: name, password, confirm password, optional hint, optional note | P0 |
| RF-UI-12 | Unlock screen may show **`password_hint`** from config when non-empty (never auto-fill password) | P1 |
| RF-UI-13 | **Reorder vault list:** drag-and-drop rows (press/hold + drag); persist new positions to `[vault] order` in each affected `config.toml` | P1 |
| RF-UI-14 | Vault settings modal exposes **`order`** field under `[vault]` (alternative to drag-and-drop) | P1 |

---

## 4. Password/session security modes

Configurable in `config/<id>.toml` as `security.mode`.

| Mode | ID | Summary behavior |
|------|-----|------------------------|
| 1 — Maximum | `always_prompt` | Prompt on open and close; do not retain in RAM |
| 2 — Default | `session_ram` | One password per session in RAM; after reboot prompt again |
| 3 | `ram_on_close_only` | Clear RAM after open; password in RAM only during close operation |
| 4 | `disk_close` | `session.enc` on disk to close without retyping; open always prompts |
| 5 — Less secure | `disk_open_close` | `session.enc` to open and close without retyping |

**Recommended default:** `session_ram` (mode 2).

**Global rule:** no mode writes password in plaintext in the vault.

**Rule for `encrypted_dir` (mandatory):**

- Do not allow disk modes (`disk_close`, `disk_open_close`).
- Do not create `session.enc` or `.quick-auth`.
- Do not show save/remember password option in UI for this mode.
- Session in RAM only (`always_prompt`, `session_ram`, or `ram_on_close_only`).

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
    │   ├── exemplo-1.toml         # [vault] vault_file, auth_dir
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
| RNF-03 | Single executable per OS (Tauri); `7zz` as bundled dependency |
| RNF-04 | UTF-8 config, paths relative to vault root |
| RNF-05 | Core code in Rust (`upriv-core`); desktop UI React web + Tauri 2; mobile UI React Native + Rust FFI (later phases). UI layers are presentation only — crypto, RAM session, and disk I/O live in Rust. See `ARCHITECTURE.md` |
| RNF-05b | **v1:** desktop app **Linux only**; vault format and `.7z` portable from the start |
| RNF-06 | License and dependencies compatible with `7zz` distribution |

---

## 7. Success metrics (MVP)

- User creates vault, adds files, closes and reopens on another PC with same `.7z`.
- After simulating crash (orphan workspace), recovery closes vault without corrupting old `.7z`.
- Wrong password on close **does not** generate valid new `.7z`.
- Opening `vaults/<id>.7z` with external 7-Zip works with same password.

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
| Very large vault | Document limits; multiple vaults; `plain` if insufficient RAM |
| Android: OTG disconnected with vault open | Recovery; UI warnings |
| Android: Intent doesn't open folder in some manager | Chooser + document tested apps |
| Android: storage scope | SAF mandatory |
| `plain` mode | Warning + `secure_wipe_workspace` (RF-41–44); no SSD guarantee |
| Accumulated backups | RF-56 UI; `keep_last` policy / delete old |

---

## 9. Suggested roadmap

### MVP (v0.1)
- **Linux only** (first implementation)
- **Single v1 flow:** `.7z` → encrypted store → virtual `workspace` → close → new `.7z` (see §1.9)
- `settings.toml` + defaults
- Basic recovery + `manifest` (RF-47–48)
- States `open` / `closed` / `sealed` (RF-53, RF-53b)
- RAM-only session; no password persistence on HD
- Virtual mount + anti-plaintext tests (RF-49)
- Vault list UI + dark theme (RF-UI-01–10; §3.7)

### v0.2
- Windows (Tauri + mount)
- Backup in `backup/<id>/` (`keep_last` / `keep_all`)
- Exception mode `plain` (insufficient RAM / fallback)
- 5 security modes + `session.enc` (exception mode only, if applicable)
- Settings UI

### v0.3
- macOS

### v0.4 — Android
- React Native + `upriv-core` (native module / FFI); single APK bundles UI, bridge, and `libupriv_core.so`
- SAF: link vault folder on OTG HD
- Workspace `workspace/` on HD (desktop parity)
- Open/close vault; OTG recovery
- Button `action.open_folder` → Intent to external manager
- APK in `.upriv/app/Android/` in HD bundle
- Documented Plan B (ZArchiver + `vaults/<id>.7z`)

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
| **`archive`** | `layer.archive` | Portable `.7z` container (Plan B) | `vaults/<id>.7z` |
| **`store`** | `layer.store` | Encrypted persistence on HD/SSD | `.upriv/stores/<id>/` |
| **`session`** | `layer.session` | Active logical view (mount + RAM; write-through → `store`) | virtual `workspace/<id>/` |
| **`plain`** | `layer.plain` | Exception: files **in plaintext** on HD between open and close | real `workspace/<id>/` |

Secure flow: **`archive` → `store` → `session`**. Sealed close: back to **`archive`** only.

Exception mode: **`archive` → `plain` → `archive`** (no `store`).

`storage.mode` in TOML (readable aliases):

| `storage.mode` | Layers used |
|----------------|----------------|
| `encrypted_dir` | `archive` + `store` + `session` (v1 default) |
| `plain` | `archive` + **`plain`** layer (v1.1+) |

Suggested Rust modules: `upriv_core::archive`, `::store`, `::session`, `::plain`.

### 11.2 Glossary

| Term | Definition |
|-------|-----------|
| Vault / vault-root | Folder `<vault-root>` with standardized layout (not the vault itself) |
| **`archive`** | Layer L0 — `vaults/<id>.7z` |
| **`store`** | Layer L1 — encrypted `stores/<id>/` |
| **`session`** | Layer L2 — virtual mount + keys in RAM |
| **`plain`** | Exception layer — plaintext workspace on disk |
| Close vault | `7z t` → `.7z` → `close` or `seal` → unmount → zeroize RAM |
| `open` | Active `session` (runtime) |
| `closed` | Synchronized `archive` + `store` |
| `sealed` | `archive` only — **same** in both modes |
| Manifest | Sync `archive` ↔ `store` (`sync_generation`, timestamps, hashes) |
| Plan B | Open **`archive`** with 7-Zip |
| SAF | Storage Access Framework (Android) |
| Vault URI | `content://` reference to vault root on Android |

---

*Document intended to align implementation (see SDD.md) and onboarding of other AIs or developers.*
