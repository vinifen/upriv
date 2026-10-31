# No durable plaintext (`encrypted_dir`)

## Hard rule

In default mode `encrypted_dir`, **never** write or read decrypted vault file trees on ordinary disk (`/tmp`, `%TEMP%`, vault `workspace/`, crash staging, Android `filesDir`). Decrypt only in RAM (FUSE/WinFsp on desktop; in-app file manager on mobile); persist only ciphertext in `store/`. Close flushes the session into `store/` (PRD RF-45/RF-49). Export `.7z` (separate action) must **stream** logical content — never pack `.enc` blobs.

**Transitional phases** (import, export, backup copy, password, recovery, cancel/crash) are the usual leak. A temp extract “just for 7zz / zip” is still a spill. Fail the op rather than write plaintext.

The **only** product exceptions: `upriv_plain` may use real plaintext `workspace/` **while open**, with UI warning + wipe on close. It holds what the person sent there, or every file with `plain_files = "whole"`. Close now, the person's own choice, removes those files with no overwrite; no other close may. A plain-text `.zip` export is the readable file a person chose behind the vault password and a red warning, so they can always take their data out; its `.upriv-part` is wiped on a stop, a failure, or the launch after a crash. Never use either path as a helper for `encrypted_dir`.

## Do not port from `temp/upriv/`

The snapshot's `finalize_close` / `materialize_store_from_archive` / change-password use `tempfile` + `export_logical_tree` + `create_from_dir` — **full plaintext trees on OS temp**. That pattern is **forbidden** in `dev/`.

Also ban: `DevPlaintext` dump-to-workspace; `7zz -p` on argv.

## When implementing vault I/O

Stream logical bytes in RAM (as `.7z` export/import do). If a directory is unavoidable: tmpfs+noswap + RAII wipe only. Add RF-49 tests. Fail closed on mount/RAM failure — never silent spill.

Full detail: [`.agent/SECURITY-PLAINTEXT.md`](../SECURITY-PLAINTEXT.md).
