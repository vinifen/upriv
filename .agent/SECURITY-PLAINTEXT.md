# Critical: no durable plaintext on disk (`encrypted_dir`)

**Audience:** coding agents and humans implementing vault open/close/mount/7z.  
**Status:** ship-blocking invariant for the default product mode.  
**Canonical requirements:** PRD **RF-45**, **RF-49**, **RF-49b**, **RF-50**; SDD **§2.4**, **§2.6**.  
**Product exception:** `storage.mode = upriv_plain` may write plaintext under `workspace/` **only** with the matching UI warning and close wipe (`secure_wipe_workspace`). That is the **only** product choice that may expose vault file bytes on ordinary disk. (`plain` / `plain_only` in PRD are dropped — see [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md).)

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
4. On close: flush the session into **`store/`**. Export `.7z` (separate action) packs **logical** content **in RAM** — do **not** pack `.enc` blobs; do **not** materialize a plaintext tree for `7zz`. Import `.7z` the same way (in-process decode into `store/`). Fail closed if RAM is insufficient. No Seal.
5. If `7zz` absolutely requires a directory: **only** tmpfs (or equivalent) with **noswap** where available, RAII delete + secure wipe, **never** use real `workspace/` as staging (SDD §2.6).
6. Insufficient RAM → **fail open/edit/close** with a user-visible error — **never** silently spill plaintext to disk (`warning.encrypted_dir_ram`).

`dev/` today has **no** vault crypto yet — the invariant is **specified but not enforceable**. That is not permission to ship tempfile staging later.

---

## What `temp/upriv/` got wrong (do not port)

Research snapshot Tauri tree under `temp/upriv/` (gitignored). FUSE session path is largely correct; **archive transitions are not**.

| When | Bad pattern | Evidence (snapshot paths) |
|------|-------------|-------------------------|
| Every `encrypted_dir` close/seal | `tempfile::tempdir` → `export_logical_tree` → `create_from_dir` | `encrypted_dir/mod.rs` `finalize_close` |
| Open sealed / materialize store | `7z extract` → plaintext tempfile → `import_logical_tree` | `materialize_store_from_archive` |
| Recovery “use store” | same staging as close | `sync_archive_from_store` |
| Change password | extract full archive to tempfile, recreate `.7z` | `vault/change_password.rs` |
| Create vault | welcome file in tempfile | `vault/create.rs` |
| FUSE fail + `debug_assertions` | dump store to real `workspace/` | `DevPlaintext` fallback |

`export_logical_tree` decrypts each file to `Vec` then `fs::write` — full plaintext tree on OS temp. `TempDir` drop deletes without `secure_wipe`. Password often passed as `7zz -p…` on argv (process-list leak).

**Forbidden:** copy-paste `finalize_close` / `materialize_store_from_archive` / change-password extract-repack into `dev/`.

**OK to learn from temp:** FUSE read/write → store encrypt path; plain mode extract/wipe shape; index/chunk store layout ideas — then **rewrite** to match Electron + RPC + RF-45.

---

## Required design for `dev/` (future work)

When implementing `seven_zip` + close pipeline:

1. Prefer **`SevenZip::create_from_logical`** (or equivalent): stream decrypted bytes from store/session into `7zz` without a plaintext directory tree.
2. Same rule for **import**, **export**, **change password**, **recovery** — no full-tree extract to disk in `encrypted_dir`.
3. Pass password via **stdin / restricted channel**, never `-p` on argv.
4. **Ban `DevPlaintext`** (or any “dump store to workspace”) in builds users can run — mount failure → fail closed.
5. Hard `ensure_encrypted_dir` / `ensure_plain` on every open/close path so modes cannot mix.
6. Automated tests (RF-49 / RF-45):
   - After mount write: no regular files under real `workspace/<id>/` on the vault volume.
   - Ciphertext present in `store/` (write-through).
   - After close: no leftover plaintext staging under OS temp (or only documented tmpfs that is wiped).
   - CI fails if release `encrypted_dir` paths call `export_logical_tree` to ordinary disk.

---

## Acceptable vs unacceptable plaintext

| Case | Allowed? |
|------|----------|
| FUSE/WinFsp buffers / in-app file-manager buffers / process RAM while vault open | Yes (document swap/hibernation limits — RF-51) |
| Encrypted `store/` on disk | Yes |
| Destination `.7z` / Upriv `.zip` package (export payload) | Yes — ciphertext |
| `upriv_plain` mode `workspace/` while open + wipe on close | Yes, with UI warning |
| OS tempfile / vault `workspace/` full decrypted tree in `encrypted_dir` (including “temp for 7zz”, crash leftover) | **No — ship blocker** |
| External editor caches/thumbnails outside mount | Document (RF-52); do not claim absolute zero OS side effects |

---

## Agent checklist (before merging vault I/O)

- [ ] No `export_logical_tree` / plaintext `create_from_dir` staging in `encrypted_dir` release paths  
- [ ] No `DevPlaintext`-style fallback in user builds  
- [ ] Close/materialize/password/recovery reviewed against RF-45  
- [ ] RF-49 tests added or explicitly tracked as blocking  
- [ ] `upriv_plain` paths gated and warned; wipe on close  
- [ ] Import/export/password/recovery: no plaintext leftover after cancel, timeout, or crash

If unsure: **plaintext on disk only when the user chose `upriv_plain`.** Do not invent a “temporary plaintext is fine” shortcut for `encrypted_dir`.
