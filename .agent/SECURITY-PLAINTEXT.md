# Critical: no durable plaintext on disk (`encrypted_dir`)

**Audience:** coding agents and humans implementing vault open/close/mount/7z.  
**Status:** ship-blocking invariant for the default product mode.  
**Canonical requirements:** PRD **RF-45**, **RF-49**, **RF-49b**, **RF-50**; SDD **§2.4**, **§2.6**.  
**Product exception:** `storage.mode = plain` may write plaintext under `workspace/` **only** with UI `warning.plain_mode` and close wipe (`secure_wipe_workspace`).

---

## Invariant (must never regress)

In **`encrypted_dir`** (default):

1. **Never** write decrypted vault file bytes to ordinary disk (vault volume, `/tmp`, `%TEMP%`, crash staging dirs, etc.).
2. **Never** read vault content from a durable plaintext tree on disk (except intentional `plain` mode).
3. While open: decrypt only into **RAM / FUSE–WinFsp reply buffers**; persist only **ciphertext** in `stores/<id>/` (write-through).
4. On close/seal: build `.7z` from **logical content stream** — do **not** pack `.enc` blobs; do **not** materialize a full plaintext tree for `7zz`.
5. If `7zz` absolutely requires a directory: **only** tmpfs (or equivalent) with **noswap** where available, RAII delete + secure wipe, **never** use real `workspace/` as staging (SDD §2.6).
6. Insufficient RAM → **fail open/edit/close** with a user-visible error — **never** silently spill plaintext to disk (`warning.encrypted_dir_ram`).

`dev/` today has **no** vault crypto yet — the invariant is **specified but not enforceable**. That is not permission to ship tempfile staging later.

---

## What `temp/upriv/` got wrong (do not port)

Legacy Tauri tree under `temp/upriv/` (gitignored research snapshot). FUSE session path is largely correct; **archive transitions are not**.

| When | Bad pattern | Evidence (legacy paths) |
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
2. Same rule for **materialize**, **change password**, **recovery** archive rebuild — no full-tree extract to disk in `encrypted_dir`.
3. Pass password via **stdin / restricted channel**, never `-p` on argv.
4. **Ban `DevPlaintext`** (or any “dump store to workspace”) in builds users can run — mount failure → fail closed.
5. Hard `ensure_encrypted_dir` / `ensure_plain` on every open/close path so modes cannot mix.
6. Automated tests (RF-49 / RF-45):
   - After mount write: no regular files under real `workspace/<id>/` on the vault volume.
   - Ciphertext present in `stores/<id>/` (write-through).
   - After close: no leftover plaintext staging under OS temp (or only documented tmpfs that is wiped).
   - CI fails if release `encrypted_dir` paths call `export_logical_tree` to ordinary disk.

---

## Acceptable vs unacceptable plaintext

| Case | Allowed? |
|------|----------|
| FUSE/WinFsp buffers / process RAM while vault open | Yes (document swap/hibernation limits — RF-51) |
| Encrypted `store/` + sealed `.7z` on disk | Yes |
| `plain` mode `workspace/` while open + wipe on close | Yes, with UI warning |
| OS tempfile / vault `workspace/` full decrypted tree in `encrypted_dir` | **No — ship blocker** |
| External editor caches/thumbnails outside mount | Document (RF-52); do not claim absolute zero OS side effects |

---

## Agent checklist (before merging vault I/O)

- [ ] No `export_logical_tree` / plaintext `create_from_dir` staging in `encrypted_dir` release paths  
- [ ] No `DevPlaintext`-style fallback in user builds  
- [ ] Close/materialize/password/recovery reviewed against RF-45  
- [ ] RF-49 tests added or explicitly tracked as blocking  
- [ ] `plain` paths gated and warned; wipe on seal/close  

If unsure: **read PRD RF-45/RF-49 and SDD §2.6** — do not invent a “temporary plaintext is fine” shortcut.
