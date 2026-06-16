# Upriv — reference bundle (vault-oriented layout)

**Standalone sample only.** This folder shows what a user’s vault-root looks like on an external drive. It is **not** linked to `dev/` — no symlinks, no build dependency. To try the desktop app against this layout, set `UPRIV_VAULT_ROOT` to an absolute copy of this folder (or this path if you run locally).

**`.upriv/` is a normal directory** (not a symbolic link): the hidden system folder inside `<vault-root>`. Nothing in `dev/` points at or links to this folder.

Copy this folder to the root of an external drive or work directory. The Upriv marker is `.upriv/settings.toml`.

Canonical layout for the product — see **`dev/docs/sdd.md`** §3 and **`dev/docs/prd.md`** (implementation may lag this bundle).

## `settings.toml` vs `config.toml`

| File | Scope | Contents |
|------|--------|----------|
| **`.upriv/settings.toml`** | App / drive | Marker, paths, UI, logging, app preferences |
| **`vaults/<id>/config.toml`** | One vault | Vault config: storage mode, security, backup, 7z, policies, optional **`order`**, **`password_hint`**, **`note`**, and **`hidden`** |

Same word **config**, different **folder** — no collision. Discovery: scan `vaults/*/config.toml` on app start.

## Package layout

| Path | Contents |
|------|----------|
| **`.upriv/settings.toml`** | App marker, paths, UI, logging |
| **`.upriv/state.json`** | Open sessions only (volatile; cleared on quit) |
| **`.upriv/vaults/<id>/`** | Per vault: `config.toml`, `persistence.json`, `archive/`, `store/`, `backups/`, `auth/` |
| **`.upriv/logs/`** | App logs (`.log`, 1000 lines per file; see § Logs) |
| **`.upriv/app/`** | Platform binaries + brand assets |
| **`workspace/<display_name>/`** | Mount targets while open — user-visible name (package root) |

```text
.upriv/
├── settings.toml
├── state.json
├── logs/
├── app/
└── vaults/
    ├── my-encrypted-notes/   # display: My Encrypted Notes — closed, open in state.json
    ├── vault-example-2/      # display: Vault ExaMple 2 — sealed
    ├── cold-storage/         # display: Cold Storage — sealed
    └── plain-folder-demo/    # display: Plain Folder Demo — plain + auth/
```

## `state.json` vs per-vault `persistence.json`

| Source | Role |
|--------|------|
| `vaults/<id>/config.toml` | Registry — all vaults |
| `vaults/<id>/persistence.json` | Persisted `closed` \| `sealed` + sync hashes; `vault_id` (normalized) + `display_name` (UI / main `.7z`) |
| **`state.json`** | Who is unlocked *right now* |

`state.json` does **not** replace `persistence.json`. It holds no passwords or keys — only session metadata (`session: open`, resolved paths, timestamps).

Sealed vaults **2** and **3** are registered but **not** listed in `state.json` in this demo.

### Open in `state.json` (this demo)

| Vault | `storage_mode` | `security_mode` |
|-------|----------------|-----------------|
| `my-encrypted-notes` | `encrypted_dir` | `session_ram` |
| `plain-folder-demo` | `plain` | `disk_open_close` |

Example entry fields: `workspace`, `vault_root`, `archive_path`, `store_path` (encrypted_dir) or `auth_path` (plain), `opened_at`, `last_activity_at`.

Lockfiles (implementation): `.upriv/<id>.lock` — not shipped in this static bundle.

## `vaults/<id>/` — one folder per vault

```text
vaults/<id>/                    # <id> = normalized slug (filesystem-safe)
├── config.toml
├── persistence.json
├── archive/<user-name>.7z      # Plan B — user name verbatim (NOT normalized)
├── store/
├── backups/                    # standard snapshots — normalized names; rotated per [backup]
│   └── saves/                # pinned saves — never removed by keep_last
└── auth/
```

**Why `archive/`:** fixed subfolder in every vault — the heart of the vault lives here; copy/export `archive/` without typing the user filename; config/store/backups stay separate at the vault root.

**Seal rule:** delete `store/` only; keep `config.toml`, `persistence.json`, and `archive/`.

### Archive vs normalized names

| What | Normalized? | Example |
|------|-------------|---------|
| Vault folder `vaults/<id>/` | **Yes** | `my-encrypted-notes/` |
| `vault_id` in `config.toml` / `persistence.json` | **Yes** | `my-encrypted-notes` |
| `display_name` | **No** — verbatim user input | `My Encrypted Notes` |
| **Main archive** | **No** — `{display_name}.7z` | `archive/My Encrypted Notes.7z` |
| `backups/*.7z` | **Yes** | `20260528T120000-vault-example-2.7z` |
| `backups/saves/*.7z` | **Yes** | `20260401T100000-my-encrypted-notes.7z` |
| `store/`, logs | **Yes** | paths use `vault_id` |
| **`workspace/`** | **No** | `workspace/{display_name}/` — same as UI |

Rule: the **Plan B file** keeps the name the user created (spaces, casing, accents allowed where the OS allows). **Everything the app generates** around it uses the normalized `vault_id`.

Quote `vault_file` in TOML when the name contains spaces.

### Forbidden characters (`display_name` / main `.7z`)

Validated on **create vault**, **rename vault**, and **import archive → new vault**. Target: all supported OSes (Windows rules are the strictest).

| Rule | Detail |
|------|--------|
| **Forbidden characters** | `\ / : * ? " < > \|` and ASCII control chars (`U+0000`–`U+001F`) |
| **Empty / whitespace-only** | Rejected |
| **Trailing space or `.`** | Rejected (Windows) |
| **Length** | `display_name` max **128** chars; `vault_id` slug max **64** after normalization |
| **Reserved Windows stems** | Rejected as whole name (case-insensitive): `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` |

**Allowed:** spaces, mixed case, Unicode letters and accents (e.g. `Finanças`, `Vault ExaMple 2`) — as long as no forbidden character appears.

**`vault_id` generation** (always normalized, never shown as primary UI label):

1. Trim; lowercase for slug.
2. Replace spaces with `-`.
3. Remove `\ / : * ? " < > \|` and control chars.
4. Unicode: optional NFKD + strip combining marks for slug only (`Finanças` → `financas`).
5. Collapse repeated `-`; trim `-` from ends.
6. If empty after step 3–5, use `vault` + random suffix.
7. If collision with existing `vaults/<vault_id>/`, append `-2`, `-3`, …

### Export `.7z` (save outside Upriv)

| Step | Behaviour |
|------|-----------|
| Default filename | `{display_name}.7z` — same as UI / `archive/` |
| User picks path | Save dialog; user may change folder or filename |
| Destination name has forbidden chars | **Block save** or offer **minimal fix** (replace each forbidden char with `-`, trim trailing space/`.`) — show i18n `vault.export.filename_sanitized` |
| Source vault | **`display_name` unchanged** — export only affects the copy on disk |

Export does **not** rename `archive/` inside the vault.

### Import exported `.7z` → **new vault**

When the user selects an external `.7z` (e.g. exported copy) to **create** a vault on this drive:

| Step | Behaviour |
|------|-----------|
| 1. Propose name | Filename stem (without `.7z`) → proposed `display_name` |
| 2. Valid name? | If passes forbidden rules → continue |
| 3. Invalid name | Dialog: editable `display_name`, pre-filled with **`sanitize_minimal(stem)`** — replace forbidden chars with `-`, trim trailing space/`.`, collapse `--` (i18n `vault.import.rename_prompt`) |
| 4. User confirms | Final `display_name` is what UI shows |
| 5. `vault_id` | Normalized slug from confirmed `display_name` (table above) |
| 6. Archive on disk | Copy file to `vaults/<vault_id>/archive/{display_name}.7z` (rename on import if external filename differed) |

**Example:** export saved elsewhere as `Finanças:2024.7z` → import proposes `Finanças-2024` → user may edit → vault folder `financas-2024/`, archive `archive/Finanças-2024.7z` (if user confirms that display name).

**Do not** silently import with a generic name — always show the name step when the filename is invalid.

See **PRD** RF-15b/c/d · **SDD** §3.2.1 · **i18n** `vault.name.*`, `vault.export.*`, `vault.import.*`.


### Demo matrix

| `vault_id` | `display_name` | Persisted | Runtime |
|------------|----------------|-----------|---------|
| `my-encrypted-notes` | My Encrypted Notes | `closed` | open |
| `vault-example-2` | Vault ExaMple 2 | `sealed` | — |
| `cold-storage` | Cold Storage | `sealed` | — |
| `plain-folder-demo` | Plain Folder Demo | `closed` | open |

### Backups (per vault)

Two tiers under `backups/`:

| Tier | Path | Retention |
|------|------|-----------|
| **Standard** | `backups/{timestamp}-{vault_id}.7z` | Rotated on close per `[backup]` (`keep_last` / `keep_all`) |
| **Saves** | `backups/saves/{timestamp}-{vault_id}.7z` | Never auto-deleted; user promotes from standard in the backups modal |

- **Example 1 (`my-encrypted-notes`, `keep_last`):** save `backups/saves/20260401T100000-my-encrypted-notes.7z` + standard `20260515T090000-…` and `20260528T120000-…` (oldest standard removed when over limit).
- **Example 2 (`vault-example-2`, `keep_all`):** save `backups/saves/20260501T080000-vault-example-2.7z` + standard `20260528T*-vault-example-2.7z`; main archive `archive/Vault ExaMple 2.7z` (user name).

### Auth (example 4 only)

Local session for **`plain`** + **`disk_open_close`**: `.upriv/vaults/plain-folder-demo/auth/`.

Forbidden in `encrypted_dir` / `session_ram` vaults.

### Password hint, note, and change password

Stored in **`config.toml`** (not `persistence.json`):

| Field | Section | Purpose |
|-------|---------|---------|
| `order` | `[vault]` | Display order in the vault list (ascending integer; lower = higher on screen). Omit → sorted after explicit values, then by `display_name` |
| `password_hint` | `[vault]` | Optional reminder at unlock — **not** the password (max 128 chars) |
| `note` | `[vault]` | Optional short user annotation (max 256 chars) |
| `hidden` | `[vault]` | When `true`, vault stays on disk but is omitted from the list until the user shows hidden vaults (system settings or session toggle) |
| `password_changed_at` | `[security]` | ISO 8601 UTC; set by app after change password; omitted until first change |

**Vault list order:** on app start (and when the list reloads), sort all vaults by `[vault] order` ascending; tie-break by `display_name` (case-insensitive). This field is **only** for UI ordering — it does not affect paths, discovery, or sync.

**Change order in the app:** edit **`order`** in vault settings, or **drag-and-drop** a vault row on the main list (press/hold, drag up/down) — both persist to `config.toml`.

**Create new vault (not import):** wizard asks for password, confirm password, optional hint, optional note.

**Change password:** vault settings → **Security**; requires current + new + confirm; works with vault **open or closed** (current password always required). `upriv-core` validates, re-encrypts archive + store in RAM/temp, replaces files atomically. UI warns (**`warning.password_change_backups`**) that files in `backups/` keep the password from when each snapshot was created — only the main archive and future backups use the new password. See SDD §3.2.3.

**Settings UI (v1):** subset of `config.toml` — see SDD §3.2.3a (e.g. no vault `id`/paths in form; `session_ram` fixed; explicit Save/discard on close).

Example (vault 3): `prod/.upriv/vaults/cold-storage/config.toml`.

## `workspace/`

What the **user** sees while a vault is open.

| Vault | Mode | In `state.json` | Literal files in `workspace/` on HD |
|-------|------|-----------------|-------------------------------------|
| `my-encrypted-notes` | `encrypted_dir` | Yes (open) | Yes (demo mount path) |
| `vault-example-2` | `encrypted_dir` | No (sealed) | No |
| `cold-storage` | `encrypted_dir` | No (sealed) | No |
| **`plain-folder-demo`** | **`plain`** | Yes | **Yes** (plaintext on disk) |

### `encrypted_dir` (1, 2, 3)

- **RAM:** `state.json` → `session: open`, password/keys in memory.
- **User path:** `workspace/{display_name}/` via virtual mount (FUSE), e.g. `workspace/My Encrypted Notes/`.
- **HD:** ciphertext in `.upriv/vaults/<id>/store/` — not durable plaintext in `workspace/` in production.
- Demo folder for **1** only illustrates a mount path (2 and 3 are sealed on disk).

### `plain` (4 only)

- Listed in `state.json` as `plain` / `disk_open_close`.
- **Literal plaintext** in `workspace/Plain Folder Demo/` until **seal**.
- **Local password on disk:** `.upriv/vaults/plain-folder-demo/auth/`.
- **No** `store/` for this vault.
- On seal: new `.7z` + `secure_wipe_workspace` + remove workspace tree.

See `workspace/Plain Folder Demo/PLAIN-MODE.txt` and `workspace/My Encrypted Notes/STORE-WRITE-MAP.txt`.

| Path | Mode |
|------|------|
| `workspace/My Encrypted Notes/` | encrypted_dir sample |
| `workspace/Plain Folder Demo/` | plain — plaintext in repo for demo |

## `.upriv/app/`

### Brand assets (`app/assets/`)

| File | Use |
|------|-----|
| `Upriv-wordmark.svg` | Header / splash — transparent, `currentColor` |
| `Upriv-wordmark-{white,black,navy}.svg` / `.png` | Fixed-color wordmark exports |
| `Upriv.svg` / `Upriv.png` | App icon, 512×512 PNG |
| `Upriv-icon.svg` / `Upriv-icon.png` | Monogram **U** (favicon, tray) |

PNG files are rasterized from SVG (`cairosvg`). Documented in **SDD §8.2.1** and **PRD §3.7**.

| Variant | Hex |
|---------|-----|
| White | `#FFFFFF` |
| Black | `#000000` |
| Navy | `#0B0E1E` |

Dark theme tokens: background `#0f172a`, foreground `#f8fafc`, accent `#6b8cff`.

Brand assets live in-repo under `prod/.upriv/app/assets/` (see SDD §8.2.1, PRD §3.7).

### `app/macOS-x64/` (Intel)

**v1 bundle:** only `macOS-arm64/` (Apple Silicon) is included.

For Intel Macs, place `Upriv.app` here (same layout as `macOS-arm64/`). Root `Upriv-mac` picks arm64 or x64 via `uname -m`.

## Logs (`.upriv/logs/`)

Plain **`.log`** text. **1000 entries per file** — index **1–1000 inside each file only** (resets when a new file starts; never continues 1001, 1002, … in the next file).

### File names

| State | Pattern | Example |
|-------|---------|---------|
| **Active (being written)** | `current-{seq}-{created_utc}.log` | `current-000001-20260529120000.log` |
| **Archived (closed)** | `{seq}-{created_utc}.log` | `000001-20260529120000.log` |

- **`seq`:** file number **1, 2, 3, …** — monotonic across the log history (`000001`, `000002`, … zero-padded).
- **`created_utc`:** timestamp when **that file was created** (`YYYYMMDDHHmmss`, UTC). Ties each file to its place in time and keeps order obvious next to `seq`.

Only **one** file has the `current-` prefix at a time — the one the app is appending to now.

### Rotation (when entry 1000 is written)

1. Finish line `1000` in the active file.
2. **Rename** the active file: remove the `current-` prefix (e.g. `current-000001-20260529120000.log` → `000001-20260529120000.log`).
3. **Create** the next file with `current-`, next `seq`, and **new** `created_utc` (e.g. `current-000002-20260529143022.log`).
4. First line in the new file is index **`0001`** again.

Never lose which file is active: if the app crashes, the file still named `current-…` is the resume target (append from last index + 1, or validate line count).

### Line format

```text
{index:04d} {iso8601_utc} {LEVEL} {event} key=value …
```

| Field | Rule |
|-------|------|
| `index` | **1–1000** per file, **04d** padded (`0001` … `1000`) |
| time | ISO 8601 UTC with ms, e.g. `2026-05-29T14:32:01.123Z` |
| `LEVEL` | `TRACE` \| `DEBUG` \| `INFO` \| `WARN` \| `ERROR` |
| `event` | short snake_case name |
| tail | optional `key=value` fields (no passwords/secrets) |

Example (file `current-000001-…`):

```text
0001 2026-05-29T12:00:00.010Z INFO  app_start          version=0.2.0-demo vaults=4
0002 2026-05-29T12:00:00.120Z INFO  vault_discovered   vault=my-encrypted-notes persistence=closed
0003 2026-05-29T12:01:15.402Z INFO  vault_open         vault=my-encrypted-notes storage_mode=encrypted_dir
```

### UI (`settings.toml` → `[ui]`)

| Key | Type | Default (demo) | Effect |
|-----|------|----------------|--------|
| `locale` | string | `"en"` | UI strings — `dev/apps/shared/locales/{locale}.json` |
| `theme` | string | `"dark"` | `"dark"` \| `"light"` |
| `vault_list_sort` | string | `"order"` | `order` \| `name` \| `state` \| `last_accessed` |
| `vault_list_sort_direction` | string | `"asc"` | `asc` \| `desc` |
| `vault_list_view` | string | `"default"` | `default` \| `large` \| `compact` \| `blocks` |
| `always_show_hidden_vaults` | bool | `false` | When `true`, vaults with `[vault] hidden = true` appear in the list on every launch |
| `file_manager_dock_expanded` | bool | `false` | When `true`, minimized file manager chips stay expanded; when `false`, only a single button expands the dock |

**Demo:** `finance-2025` has `hidden = true` in `config.toml`; list visibility also depends on `always_show_hidden_vaults` and the session “show hidden vaults” toggle in system settings.

### Logging (`settings.toml` → `[logging]`)

| Key | Type | Default (demo) | Effect |
|-----|------|----------------|--------|
| `enabled` | bool | `true` | `false` = logging **off** — no new lines, no rotation, no `current-*.log` created |
| `level` | string | `"info"` | Only write events at this level or higher (`trace` … `error`) |
| `entries_per_file` | u16 | `1000` | Lines per file before rotate (1–1000 index per file) |

Paths: `logs_dir = ".upriv/logs"` in `[package]`.

**Examples:**

```toml
[logging]
enabled = false
level = "info"
```

No file output; existing archived logs on disk are left untouched.

```toml
[logging]
enabled = true
level = "warn"
```

Only `WARN` and `ERROR` lines are written; rotation unchanged.

```toml
[logging]
enabled = true
level = "debug"
entries_per_file = 1000
```

Full detail for development.

On app start: read `[logging]` before opening the log writer. If `enabled = false`, skip `logs/` entirely (optional: stderr in dev builds only — not part of this bundle spec).

Implementation (Rust): `tracing` + custom writer; respect `enabled` and `LevelFilter::from_str(level)`; track index, `seq`, rename on rotate.

## Layers

```text
encrypted_dir: archive → store → session (workspace virtual)
plain (ex. 4):   archive → workspace literal on HD + auth local
```

UI strings: `dev/apps/shared/locales/`, `dev/docs/LOCALE.md`.
