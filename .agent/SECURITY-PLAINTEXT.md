# Critical: no durable plaintext on disk (`encrypted_dir`)

**Audience:** coding agents and humans implementing vault open/close/mount/7z.  
**Status:** ship-blocking invariant for the default product mode.  
**Canonical requirements:** PRD **RF-45**, **RF-49**, **RF-49b**, **RF-50**; SDD **§2.4**, **§2.6**.  
**Product exceptions:** exactly two product choices may expose vault file bytes on ordinary disk.

1. `storage.mode = upriv_plain` may write plaintext into its unlocked folder (`{folder}/upriv-unlocked/{vault name}`) **only** with the matching UI warning. `storage.plain_files` starts at `chosen`: the folder starts empty and holds what the person sends from the file manager, and everything else stays ciphertext in `store/`, decrypted in RAM only while the file manager reads it, as in `encrypted_dir`. `whole` writes every file on open. Close overwrites that folder and then removes it (modes: [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md)). **Close now**, the person's own choice per vault, on a close already running, or in the quit dialog, removes the files with no overwrite, so their bytes stay on the disk until it reuses the space. Its window says so unless the person turned that question off. Recovery always overwrites.
2. **Plain-text `.zip` export.** The person chooses it per export, sees its red warning, and types the vault password. The result is readable by anyone who gets the file. It exists so a person who holds the password can always take their data out of Upriv: the vault must never read as holding their files hostage. It is the file the person asked for, in the folder they chose. It is never a helper for another path, and nothing else may stage plaintext to reach it.

---

## Transitional phases (highest leak risk)

Spills happen on **the way** between states, not in the happy resting `store/` tree. Treat every pipeline as fail-closed: crash, cancel, timeout, or error must not leave a decrypted tree on HD/SSD/`/tmp`/`%TEMP%`.

| Phase | Allowed on ordinary disk | Forbidden |
|-------|--------------------------|-----------|
| Open / close (`encrypted_dir`) | Ciphertext in `store/` | Staging a logical tree to pack or unpack |
| Import `.7z` → `store/` | Source `.7z` (already encrypted); dest chunks | Extract-then-re-encrypt via a folder |
| Export | Destination `.7z` ciphertext / Upriv `.zip` of `store/`; the plain-text `.zip` the person chose, written straight into their folder | Dump vault files to temp, then `7zz a`; leftover extract after cancel; a plain-text `.upriv-part` left after a stop, failure, or crash |
| Backup / create-from-backup | Stored zip of `store/` (ciphertext), in the data folder or a backup row's folder. Unpack only into the new vault’s `store/` | Decrypt the snapshot, or leave an unpacked backup tree |
| Change password / recovery | Rewrap in place / stream | Full extract to tempfile |
| `upriv_plain` while **open** | Its unlocked folder (user chose this mode) | Leaving that tree after close; losing track of it; using this path as a helper for `encrypted_dir` |

**Rule:** plaintext vault bytes on ordinary disk **only** if `storage.mode = upriv_plain` **and** the vault is open, or as the plain-text `.zip` a person chose to export. Convenience (“7zz needs a directory”, “zip is easier from files”, “debug dump”) is not an exception. Insufficient RAM → fail the op, never spill.

---

## Invariant (must never regress)

In **`encrypted_dir`** (default):

1. **Never** write decrypted vault file bytes to ordinary disk (vault volume, `/tmp`, `%TEMP%`, crash staging dirs, etc.).
2. **Never** read vault content from a durable plaintext tree on disk (except `upriv_plain`).
3. While open: decrypt only into **RAM** (FUSE/WinFsp reply buffers on desktop; in-app file-manager buffers on mobile); persist only **ciphertext** in `store/` (write-through).
4. On close: flush the session into **`store/`**. Export `.7z` (separate action) packs **logical** content **in RAM** — do **not** pack `.enc` blobs; do **not** materialize a plaintext tree for `7zz`. Import `.7z` the same way (in-process decode into `store/`). Fail closed if RAM is insufficient.
5. If `7zz` absolutely requires a directory: **only** tmpfs (or equivalent) with **noswap** where available, RAII delete + secure wipe, **never** use an unlocked folder as staging (SDD §2.6).
6. Insufficient RAM → **fail open/edit/close** with a user-visible error — **never** silently spill plaintext to disk (`warning.encrypted_dir_ram`).

`dev/` today has **no** vault crypto yet — the invariant is **specified but not enforceable**. That is not permission to ship tempfile staging later.

---

## What `temp/upriv/` got wrong (do not port)

Research snapshot Tauri tree under `temp/upriv/` (gitignored). FUSE session path is largely correct; **archive transitions are not**.

| When | Bad pattern | Evidence (snapshot paths) |
|------|-------------|-------------------------|
| Every `encrypted_dir` close | `tempfile::tempdir` → `export_logical_tree` → `create_from_dir` | `encrypted_dir/mod.rs` `finalize_close` |
| Open from its `.7z` | `7z extract` → plaintext tempfile → `import_logical_tree` | `materialize_store_from_archive` |
| Recovery “use store” | same staging as close | `sync_archive_from_store` |
| Change password | extract full archive to tempfile, recreate `.7z` | `vault/change_password.rs` |
| Create vault | welcome file in tempfile | `vault/create.rs` |
| FUSE fail + `debug_assertions` | dump store to a real folder on disk | `DevPlaintext` fallback |

`export_logical_tree` decrypts each file to `Vec` then `fs::write` — full plaintext tree on OS temp. `TempDir` drop deletes without `secure_wipe`. Password often passed as `7zz -p…` on argv (process-list leak).

**Forbidden:** copy-paste `finalize_close` / `materialize_store_from_archive` / change-password extract-repack into `dev/`.

**OK to learn from temp:** FUSE read/write → store encrypt path; plain mode extract/wipe shape; index/chunk store layout ideas — then **rewrite** to match Electron + RPC + RF-45.

---

## Design in `dev/`

1. **`.7z`** export packs logical files in RAM (`sevenz-rust2`, `vault/seven_zip_pack.rs`): a worker thread decrypts `store/` one chunk at a time into a short queue the encoder reads, and the pack fails closed when the RAM check refuses it. Import unpacks in RAM (`vault/seven_zip.rs`). There is no `7zz` process, so no password on argv.
2. **Import, export, backup, recovery** copy ciphertext or stream logical bytes in RAM — no decrypted tree on disk in `encrypted_dir`. **Password and unlock-RAM change** reseal the header and name index only (`vault/rewrap.rs`); file blobs are not decrypted.
3. **No dump of the store to a folder** in any build. A mount failure leaves the vault open in the in-app file manager and writes nothing.
4. **Modes stay apart:** open writes a plaintext folder only for `upriv_plain`, into the unlocked folder its lists select on this device (`vault/open_close.rs`, `vault/plain/`). The storage mode and those lists live in `config.toml` and `settings.toml`, which are not sealed: whoever can edit the data folder decides where a plain-text vault's files go on its next unlock. When the selected folder fails before the first byte (room and file names are checked first), the unlock hands over to the next folder of the chain, as every list does; one that fails after the first byte is wiped first, and only a wipe that finishes lets the unlock hand over. A wipe that falls short keeps the record, and the vault stays in recovery.
5. **Plain-text records.** Before its first byte, every plain-text folder gets a record in `.upriv/state.json`: the device ID and system, the path, a token, and the ID in the `.upriv-unlocked-id` file of the `upriv-unlocked` folder it is in (32 random hex characters, written the first time Upriv uses that folder; an ID there is never rewritten, and a file that holds none is replaced, since no record can name it). A record goes when its folder is wiped, when this device proves the folder gone, or when the person chooses Forget (`plain_record_forget`), which leaves the files as they are. Proof is the `upriv-unlocked` folder answering with the record's ID while nothing of the session is in it: the vault's folder is gone, or holds no marker of that session (the marker is written before any file and removed last by the wipe). A folder or marker that does not read proves nothing, and a Remove that finds the marker unreadable keeps the record. A folder that merely answers proves nothing either: a mount point stays as an empty folder while its drive is away, and on Windows another drive can take the same letter. While nothing proves where a record's folder is, the vault does not open on that device (`plain_folder_unreachable`) and its unlocked folder group, mode, name, and id stay locked. Deleting a vault wipes this device's leftover first and is refused while another device's record of it remains (`vault_plain_elsewhere`). Deleting a row or a device group never touches a record. A device with no ID never opens a plain-text vault (`device_unknown`), so every record names its device.
6. **Plain-text `.zip` export** (`vault/plain_zip.rs`) decrypts one chunk at a time straight into the zip, with nothing staged. The file is owner-only on Linux and macOS. Until it is complete it is a `.upriv-part` with a record in `.upriv/state.json`, written before its first byte. A stop or a failure answers at once, and the file is overwritten with the vault's `[security]` wipe settings and removed on a thread of its own (`wipe_partial_behind`); the record goes once the file is gone. A normal quit waits for that wipe. A panic in the export clears the file the same way. A file in a picked phone folder is wiped before the export ends, while that folder is still mounted. A crash, or Close now, leaves the record of what the wipe has not reached, and the vault list wipes the file at the next launch (`vault_unfinished_sweep`). On a phone that mounts the picked folder again, which the kept storage-access grant allows. Overwriting is best effort on SSD and flash, so the UI never promises more. Importing the zip streams into `store/` and leaves the person's file where it is; the wizard says so.
7. Tests that hold this (RF-49 / RF-45), among others: `encrypted_open_does_not_write_a_plaintext_folder`, `zip_export_contains_ciphertext_not_plaintext`, `wrong_password_yields_no_plaintext`. New I/O adds its own.

---

## Acceptable vs unacceptable plaintext

| Case | Allowed? |
|------|----------|
| FUSE/WinFsp buffers / in-app file-manager buffers / process RAM while vault open | Yes (document swap/hibernation limits — RF-51) |
| Encrypted `store/` on disk | Yes |
| Destination `.7z` / Upriv `.zip` package (export payload) | Yes — ciphertext |
| `upriv_plain` mode unlocked folder while open + wipe on close | Yes, with UI warning |
| `upriv_plain` files removed with no overwrite by Close now | Yes, only as the person's choice. Never as a shortcut for a normal close, an auto-close, or recovery |
| Plain-text `.zip` the person chose to export, behind the vault password and the red warning | Yes, as that one finished file. Its `.upriv-part` is wiped after a stop or a failure, before a normal quit ends, or at the launch after a crash or Close now |
| OS tempfile / any real folder holding a full decrypted tree in `encrypted_dir` (including “temp for 7zz”, crash leftover) | **No — ship blocker** |
| External editor caches/thumbnails outside mount | Linux unlocked folder: freedesktop previews are overwritten on `OPEN_PURGE_INTERVAL` while the folder is mounted, and again when it is detached. Flash is best-effort. Windows and macOS mounts, when they exist, must do the same for their own caches and must not wipe the global cache. Do not claim absolute zero OS side effects (RF-52). |

---

## Agent checklist (before merging vault I/O)

- [ ] No `export_logical_tree` / plaintext `create_from_dir` staging in `encrypted_dir` release paths  
- [ ] No `DevPlaintext`-style fallback in user builds  
- [ ] Close/import/password/recovery reviewed against RF-45  
- [ ] RF-49 tests added or explicitly tracked as blocking  
- [ ] `upriv_plain` paths gated and warned; wipe on close  
- [ ] Import/export/password/recovery: no plaintext leftover after cancel, timeout, or crash

If unsure: **plaintext on disk only when the user chose `upriv_plain` or a plain-text `.zip` export.** Do not invent a “temporary plaintext is fine” shortcut for `encrypted_dir`.
