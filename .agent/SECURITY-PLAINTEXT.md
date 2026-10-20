# Critical: no durable plaintext on disk (`encrypted_dir`)

**Audience:** coding agents and humans implementing vault open/close/mount/7z.  
**Status:** ship-blocking invariant for the default product mode.  
**Canonical requirements:** PRD **RF-45**, **RF-49**, **RF-49b**, **RF-50**; SDD **§2.4**, **§2.6**.  
**Product exception:** `storage.mode = upriv_plain` may write plaintext under `workspace/` **only** with the matching UI warning. Close overwrites that folder and then removes it. That is the **only** product choice that may expose vault file bytes on ordinary disk (modes: [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md)).

---

## Transitional phases (highest leak risk)

Spills happen on **the way** between states, not in the happy resting `store/` tree. Treat every pipeline as fail-closed: crash, cancel, timeout, or error must not leave a decrypted tree on HD/SSD/`/tmp`/`%TEMP%`.

| Phase | Allowed on ordinary disk | Forbidden |
|-------|--------------------------|-----------|
| Open / close (`encrypted_dir`) | Ciphertext in `store/` | Staging a logical tree to pack or unpack |
| Import `.7z` → `store/` | Source `.7z` (already encrypted); dest chunks | Extract-then-re-encrypt via a folder |
| Export | Destination `.7z` ciphertext / Upriv `.zip` of `store/` | Dump vault files to temp, then `7zz a`; leftover extract after cancel |
| Backup / create-from-backup | Stored zip of `store/` (ciphertext). Unpack only into the new vault’s `store/` | Decrypt the snapshot, or leave an unpacked backup tree |
| Change password / recovery | Rewrap in place / stream | Full extract to tempfile |
| `upriv_plain` while **open** | `workspace/` (user chose this mode) | Leaving that tree after close; using this path as a helper for `encrypted_dir` |

**Rule:** plaintext vault bytes on ordinary disk **only** if `storage.mode = upriv_plain` **and** the vault is open. Convenience (“7zz needs a directory”, “zip is easier from files”, “debug dump”) is not an exception. Insufficient RAM → fail the op, never spill.

---

## Invariant (must never regress)

In **`encrypted_dir`** (default):

1. **Never** write decrypted vault file bytes to ordinary disk (vault volume, `/tmp`, `%TEMP%`, crash staging dirs, etc.).
2. **Never** read vault content from a durable plaintext tree on disk (except `upriv_plain`).
3. While open: decrypt only into **RAM** (FUSE/WinFsp reply buffers on desktop; in-app file-manager buffers on mobile); persist only **ciphertext** in `store/` (write-through).
4. On close: flush the session into **`store/`**. Export `.7z` (separate action) packs **logical** content **in RAM** — do **not** pack `.enc` blobs; do **not** materialize a plaintext tree for `7zz`. Import `.7z` the same way (in-process decode into `store/`). Fail closed if RAM is insufficient.
5. If `7zz` absolutely requires a directory: **only** tmpfs (or equivalent) with **noswap** where available, RAII delete + secure wipe, **never** use real `workspace/` as staging (SDD §2.6).
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
| FUSE fail + `debug_assertions` | dump store to real `workspace/` | `DevPlaintext` fallback |

`export_logical_tree` decrypts each file to `Vec` then `fs::write` — full plaintext tree on OS temp. `TempDir` drop deletes without `secure_wipe`. Password often passed as `7zz -p…` on argv (process-list leak).

**Forbidden:** copy-paste `finalize_close` / `materialize_store_from_archive` / change-password extract-repack into `dev/`.

**OK to learn from temp:** FUSE read/write → store encrypt path; plain mode extract/wipe shape; index/chunk store layout ideas — then **rewrite** to match Electron + RPC + RF-45.

---

## Design in `dev/`

1. **`.7z`** export packs logical files in RAM (`sevenz-rust2`, `vault/seven_zip_pack.rs`) and fails closed when RAM is short; import unpacks in RAM (`vault/seven_zip.rs`). There is no `7zz` process, so no password on argv.
2. **Import, export, backup, recovery** copy ciphertext or stream logical bytes in RAM — no decrypted tree on disk in `encrypted_dir`. **Password and unlock-RAM change** reseal the header and name index only (`vault/rewrap.rs`); file blobs are not decrypted.
3. **No dump store to workspace** in any build. A mount failure leaves the vault open in the in-app file manager and writes nothing.
4. **Modes stay apart:** open writes a plaintext folder only for `upriv_plain` with the user's consent (`vault/open_close.rs`, `vault/plain/`).
5. Tests that hold this (RF-49 / RF-45), among others: `encrypted_open_does_not_write_a_plaintext_folder`, `zip_export_contains_ciphertext_not_plaintext`, `wrong_password_yields_no_plaintext`. New I/O adds its own.

---

## Acceptable vs unacceptable plaintext

| Case | Allowed? |
|------|----------|
| FUSE/WinFsp buffers / in-app file-manager buffers / process RAM while vault open | Yes (document swap/hibernation limits — RF-51) |
| Encrypted `store/` on disk | Yes |
| Destination `.7z` / Upriv `.zip` package (export payload) | Yes — ciphertext |
| `upriv_plain` mode `workspace/` while open + wipe on close | Yes, with UI warning |
| OS tempfile / vault `workspace/` full decrypted tree in `encrypted_dir` (including “temp for 7zz”, crash leftover) | **No — ship blocker** |
| External editor caches/thumbnails outside mount | Linux file-manager folder: freedesktop previews are overwritten on `OPEN_PURGE_INTERVAL` while the folder is mounted, and again when it is detached. Flash is best-effort. Windows and macOS mounts, when they exist, must do the same for their own caches and must not wipe the global cache. Do not claim absolute zero OS side effects (RF-52). |

---

## Agent checklist (before merging vault I/O)

- [ ] No `export_logical_tree` / plaintext `create_from_dir` staging in `encrypted_dir` release paths  
- [ ] No `DevPlaintext`-style fallback in user builds  
- [ ] Close/import/password/recovery reviewed against RF-45  
- [ ] RF-49 tests added or explicitly tracked as blocking  
- [ ] `upriv_plain` paths gated and warned; wipe on close  
- [ ] Import/export/password/recovery: no plaintext leftover after cancel, timeout, or crash

If unsure: **plaintext on disk only when the user chose `upriv_plain`.** Do not invent a “temporary plaintext is fine” shortcut for `encrypted_dir`.
