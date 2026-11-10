# Store crypto — Argon2id + XChaCha20-Poly1305

**Audience:** anyone implementing vault store, backups, key wrap, or `.7z` export in `upriv-core`.  
**Status:** implementation invariant **and** the bar for shipping `store/`. `dev/` has one store format (`format_version` 1): header wrap + AES-SIV index + XChaCha chunks (create writes a seed file). Chunk AAD does not bind KDF params. Password change and unlock-RAM change (`change_vault_password`, `change_vault_kdf`) keep the same master key, mint a new salt, and reseal the header wrap and the name index. File blobs stay. The vault must be closed. A safety zip of the current body is written first; if that zip fails, `store/` is left unchanged, and it is removed once the change commits. Any other `format_version` fails closed as an unreadable store.

**Greenfield.** Nothing shipped before this layout. `dev/` is the first product. Do not add a reader, migrator, or second code path for any other header, chunk, backup, or rest layout. Create and open use `format_version` 1 only. A backup is only `<stamp>-<id>.zip` in the vault's backup folder (pin: `saves/<stamp>-<id>.zip` there). That number is the vault body, not the app version. Wrap, index, and chunks all carry it; they are not separate versions. When a choice is between a compatibility shim and the direct current path, take the direct path and make that path the efficient one (no per-file full-index clone, chunk authentication that does not force a rewrite of the whole file). Do not keep two implementations.  
**Related:** PRD **RF-55**; SDD **§2.4.1**, **§6**; [SECURITY-PLAINTEXT.md](SECURITY-PLAINTEXT.md).  
**Product split:** at rest the vault body is **`store/`** (Argon2id + AEAD). **Backups** are copies of that body. Portable files: an ordinary **`.zip` of `store/`** (**Recommended**; zip is an envelope, no zip password), **`.7z`** (logical Plan B, weaker guessing), or a **plain-text `.zip`** (**Insecure**, not encrypted, so a person with the password can always take their data out). None of them lives in `.upriv` as rest.

**Greenfield:** implement only this layout.

This note records a reviewed crypto stance: primitives are strong; **the protocol around them is the real risk**. Round-trip encrypt/decrypt proves almost nothing.

**Closed `store/` (applied review, 2026-09-12):** no **known** second path to plaintext without the password. Residual attack = guess the password paying the header Argon2id. That is **not** a formal proof, **not** “impossible to break,” **not** “prevents brute force.” A weak password still loses. In-app throttle (5 fails / 60 s) is process-RAM friction only — `open_store` and any offline copy ignore it.

---

## What we are not claiming

Do **not** ship copy that says “Upriv is more secure than 7-Zip” or “the same security as VeraCrypt.”

Defensible claims:

> The vault store uses a memory-hard KDF (Argon2id) and modern AEAD (XChaCha20-Poly1305), designed for **offline password guessing** after disk theft. Portable `.7z` export remains AES-256 + SHA-256 (7z) for interoperability.

> Closed on disk, Upriv is in the **same model** as a VeraCrypt container: password + KDF. It is not an audited VeraCrypt substitute. AEAD vs XTS is one dimension (tamper/bitrot is refused vs silent garbage) — not product equivalence.

AES-256 in 7-Zip is **not** a broken cipher. The architectural gap is the **KDF** (SHA-256 iterations vs Argon2id) and **AEAD** (integrity of ciphertext + associated data), not “XChaCha beats AES.”

A 20–30 character random password in a well-made `.7z` is still extremely hard to break. `123456789` behind Argon2id is still a bad password. Order of real security:

**password → KDF parameters → protocol/implementation → cipher**

`config.toml` / `persistence.json` are **public** (list without unlock). `password_hint` is attacker knowledge. An empty hint is safer than a hint that is the password.

---

## Role of each piece

| Piece | Job |
|-------|-----|
| **Argon2id** | Password → master key. Memory-hard; GPU/ASIC guessing is expensive when `m` is large enough (RFC 9106). |
| **HKDF** | Split the random **master** into **independent** keys (content + index + recovery records). Wrap uses the Argon2 **KEK**, not an HKDF arm. Never use the raw Argon2 output as every layer’s key. |
| **XChaCha20-Poly1305** | Confidentiality + authenticity of **content chunks** (192-bit nonce → random nonces are practical). |
| **AES-SIV** (`name_cipher`) | Encrypted path index — logical names must not appear as plaintext filenames under `store/data/` (SDD §2.4.1). |
| **Poly1305 / AEAD tag** | Detects alteration. Decryption must **not** return plaintext if the tag fails (libsodium-style: authenticate first). A flipped bit on disk → hard fail, not silent garbage. |
| **`.7z` (AES-256 + SHA-256)** | **Export only** — one portable file for 7-Zip / ZArchiver. Weaker against offline guessing than the store; never kept at rest. |

7z is a **file format** (compress + encrypt). Argon2id + XChaCha20-Poly1305 is a **construction**. We must define our own on-disk protocol (`vault.header` + chunks). That protocol is where we can lose to 7-Zip even with better primitives.

---

## Target architecture

```text
password
    │
    ▼
Argon2id  (unique random salt; params stored in header)  →  KEK (wrap only)
    │
    ▼
unwrap master key (XChaCha20-Poly1305 + wrap AAD)
    │
    ▼
HKDF-SHA256 (IKM = master, salt = None, RFC 5869)
    ├── info "upriv-content-key-v1"  → content key (XChaCha chunks)
    ├── info "upriv-index-key-v1"    → index key (AES-SIV)
    └── info "upriv-record-key-v1"   → record key (XChaCha recovery records)
```

Wrap uses the Argon2 **KEK**, not an HKDF output. HKDF `salt=None` is intentional: IKM is a 32-byte CSPRNG master. Do not add a public HKDF salt without a `format_version` bump.

**At rest:** `store/` only (`vault.header` + `index/` + `data/`). Lock = close.  
**On-disk zones:** plaintext `config.toml` + `persistence.json` at `vaults/<id>/` (list/name **without** the password). Ciphertext only under `store/`.  
**Snapshots (backup):** a `<stamp>-<id>.zip` in a vault's backup folder (or in `saves/` there) is a **Stored** zip with `README.md` and `config.toml` (the public vault settings, plus a comment naming the unlock preset) beside `store/` (`header/`, `index/`, `data/`, and `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md`). `README.md` records the UTC time that copy was written and the rounded size of the files in `store/` (not the exact length of the zip). No zip password. Close writes one when `[backup] enabled`. Close now writes none, and the next normal close does, because the last backup still differs from the vault. `skip_unchanged` defaults on and skips that zip when the vault files match the last backup still on disk; `.upriv-workspace.json` is not a change. Off writes a zip on every close. Copy ciphertext; do not decrypt-then-re-encrypt. Unpack copies the ciphertext tree (`header/`, `index/`, `data/`). `README.md` and `config.toml` stay beside `store/`. The new vault writes its own `config.toml` beside `store/`, and writes `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md` into `store/` when that store is created. Export and backup write that same file before packing, so the zip keeps it inside `store/`. Kind = path (the backup folder vs `saves/`); time = the stamp in the file name (the same instant as `README.md`), which the UI shows.

**Backup folders.** The data folder (`.upriv/vaults/<id>/backups/`) is the default and the fallback. A backup may go to a folder the person chooses, on any drive: as the app default (`[backups.<os>]` in `settings.toml`, `data_folder` or `custom`) or for one vault (`[backup.<os>]` in `config.toml`, `inherit`, `data_folder`, or `custom`). Each desktop system keeps its own row; a phone has none and always uses the data folder. A vault's own folder writes to `<chosen>/upriv-<folder id>-backups/`, the app default to `<chosen>/upriv-backups/<folder id>/`, and a chosen path already ending in that name is not nested. `<folder id>` is the vault id at first use, kept in `persistence.json`, so a rename keeps finding them. A chosen folder holds the same ciphertext zips. It is never inside a `.upriv` and never overlaps a vault's file manager or plain-text folder, either way round, because a plain-text close wipes its folder. A path is checked when it is saved, never when it is loaded, and never cleared: a folder that fails is marked and stays selected.

A close and Back up now check a chosen folder first (a helper thread, one probe per folder, a 5 s limit on the check and never on the backup). Any failure writes the zip to the data folder instead and a toast says why. Close now and Stop never fall back. A zip counts once it is read back in full, renamed with no replace (the next stamp when the name is taken), and its folder flushed. The chosen folder itself is never created, so an unplugged drive does not become a new folder on the local disk: only Upriv's subfolders are made, and a subfolder this machine used that is gone is `missing` until the person picks Use this folder again (`backup_folder_reuse`).

Automatic deletion touches only the zips named in `backups_written` (`persistence.json`, in write order), so zips from a restored copy, zips made by hand, and the person's own files are never deleted automatically. A zip that cannot be checked does not count toward `keep_last`, so a reachable zip is never deleted on the strength of one Upriv cannot see. `persistence.json` keeps one record per machine (`BackupHostRecord`), so skip-unchanged holds when a data folder moves between computers. The Backups window lists every zip in the data folder and every zip in the chosen folder whose cleartext `store/header/vault.header` carries this vault's content identity; while this vault's own header is dead, every zip there is listed. A backup stays where it was written: changing the folder moves nothing, and the zips left behind stop being listed, with a toast. Deleting a vault leaves the chosen folder alone unless the person turns on its switch, which removes the zips that vault wrote and then the folders left empty, after the vault is gone; a drive that cannot be reached does not stop the delete.

The close writes its zip after the keys are gone: seal, save persistence, the plain pin, decide on the backup, mark the session closed, take the vault lock, the plain closing pass, drop the session and its keys, release the mount, and only then the zip. A slow drive waits with no key in RAM.


### Import / export

Export offers **two** payloads. Import offers the same two choices. A chosen `.zip` is classified from its central directory: `store/header/vault.header` at the zip root (a backup) or in the vault folder of an export's package is the store-zip copy; otherwise the documents are wrapped into a new `store/`. A file merely named `vault.header`, a `store/` in one folder, or a root `config.toml` alone, is not that marker. A documents `.zip` is never sent through the store-zip copy, and a store `.zip` is never encrypted as documents. Files stay **outside** `.upriv`.

**The package.** Every export holds its vault in a package: one folder named like the export file (without its extension), which carries the vault's name as the person typed it, holding one folder named after the vault's id, which holds the vault: `My notes-upriv/my-notes/…`. An import names the new vault after the name the settings it carries hold (a store zip always carries them; a `.7z` or plain-text `.zip` while its settings toggle was on), or after that inner folder when it carries none, so renaming the file (`My notes-upriv-2.zip`) never renames the vault. Backups are not exports: a backup zip keeps its envelope at the zip root, and its settings name the vault.

| Format | What it is | Security | Password to export | Opens in | UI |
|--------|------------|----------|--------------------|----------|-----|
| **`.zip` of `store/`** | Ordinary zip envelope (**no zip password**): in the package's vault folder, `README.md` and `config.toml` beside `store/` (`header/`, `index/`, `data/`, and `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md`). Not a custom file type. | Same as the vault (Argon2id + AEAD) | **None** (copy ciphertext). This vault must be closed. | Any zip tool lists ciphertext; Upriv decrypts | **Recommended** |
| **Portable `.7z`** | The package, with the vault's files directly inside its vault folder and `.upriv-config/` beside that folder when a toggle asks for it. 7-Zip AES + SHA-256 KDF; files in blocks of up to 64 MiB, each block and the header with its own random salt and IV. Not a copy of ciphertext `store/`. | Weaker **offline guessing** than the store zip (honest copy — not “Upriv beats 7-Zip”) | Vault password (decrypts `store/`, packs in RAM). This vault must be closed. | 7-Zip / ZArchiver | Versatile; warn about guessing |
| **Plain-text `.zip`** | Stored zip of the vault's readable files (no zip password) in the package's vault folder, with `.upriv-config/` beside that folder when a toggle asks for it. A zip comment, or a `.upriv-config/` beside it, marks that folder as the vault root on import. | **None.** Anyone who gets the file reads the vault | Vault password (decrypts `store/`, one chunk at a time, straight into the zip). This vault must be closed. | Any zip tool | **Insecure**: red card and warning. A stop, failure, or crash wipes the `.upriv-part` (SECURITY-PLAINTEXT) |
| **Files `.zip`** | Ordinary zip of documents (no zip password), arranged as the person chose. Same import option as a store `.zip`; the central directory decides. One shared top folder is stripped, and the file's name names the vault. | New Argon2id wrap, chosen at create | None on the zip. The new vault password wraps `store/`. | Any zip tool | Documents in. It carries no settings or layout |

**A file that cannot be read in full (recovery B)** goes into every export. A `.7z` or plain-text `.zip` keeps its readable parts, with zeros of the same length for each chunk that is missing or fails its tag, so the file keeps its size and place, and the export names it to the person (never in the log). A `.zip` of `store/` copies its ciphertext as it is.

**Create from a store `.zip`:** same as create-from-backup — new `vaults/<id>/`, copy extracted `store/` (no re-encrypt, no plaintext tree). Each entry is copied up to its stated size with no zip-checksum gate: a damaged blob comes in as it is and fails only that file when its AEAD tag is checked (recovery B), and a damaged header or index file is restored from its copy on open, so the rest of the vault comes back. Unlock = snapshot password.

**Create from `.7z`:** stream logical content into **new** `store/` (Argon2id wrap). Do not keep that `.7z` in the vault. Never pack `.enc` blobs into `.7z`. Decrypt only in RAM (SECURITY-PLAINTEXT).

**`.upriv-config/`:** a folder in the package folder of a `.7z` or a plain-text `.zip`, beside the vault folder, which holds the vault's own files and nothing else (`My notes-plain-text/.upriv-config/` beside `My notes-plain-text/my-notes/`). It holds `config.toml` (the same bytes a store zip carries), `workspace.json` (the file manager layout), and a `README.md` that explains the folder. An export writes each file only when its toggle is on (both start on), and writes no folder when neither is. In a `.7z` it is the first block, with its own salt and IV, so a password test reads the settings without decoding a vault file, and finds the vault folder from the names of every member; `config.toml` is read to its end, so its checksum also checks the password when file names are not encrypted. Importing works with any of it missing. Settings reach the new vault through the create wizard: a `.zip` shows them when it is picked, and a `.7z` when its password test passes, so the fields they can fill stay locked until then. The layout goes to `.upriv-workspace.json`, and a kept layout means no welcome note. The folder is never stored: the name is reserved in a vault at any depth, and every import skips it anywhere but beside a package's vault folder, also in an unpacked export brought in as a folder.

**Create from a files `.zip`:** stream each document into a **new** `store/` (Argon2id wrap). No zip password. Do not unpack the zip onto disk. Skip `__MACOSX` and `.DS_Store`. Reject `.upriv-workspace.json` outside `.upriv-config/`, the seed file, links, and path escape. The person's `.zip` stays where it is, readable: the wizard says so.

Export UI: user **chooses**; default / badge = `.zip` of encrypted vault.

**File name** = vault **display name** (list name), not the registry folder id, and what the file holds. The person chooses the folder in the export option before Export; core writes the file there:

| Format | File in the chosen folder | Package inside |
|--------|---------------------------|----------------|
| `.zip` of `store/` | `{display_name}-upriv.zip` | `{display_name}-upriv/{vault_id}/` |
| Portable `.7z` | `{display_name}-sevenzip.7z` | `{display_name}-sevenzip/{vault_id}/` |
| Plain-text `.zip` | `{display_name}-plain-text.zip` | `{display_name}-plain-text/{vault_id}/` |

Characters a system refuses become `_` in the **file and package folder names only** — the vault’s `display_name` does not change. The file is written as `<file>.upriv-part` and renamed into place once complete. A file already using that name, or a partial one, is never replaced: the export takes the next free number (`{display_name}-upriv-2.zip`), and its package folder takes the same name. A folder inside a `.upriv` is refused (`export_destination_reserved`). Import: the name the file's settings hold → the new vault's name, or else the package's vault folder (`vaultName` of `vault_import_probe`; a `.7z` gives it with its password test); a backup zip's settings name it; a documents `.zip` or a folder proposes its own file or folder name.

### Create vault from backup (RF-56)

Same as **create from a store `.zip`**: **new vault**, source unchanged. The snapshot **is** that zip (`<stamp>-<id>.zip` or `saves/<stamp>-<id>.zip`, in the data folder or a chosen backup folder).

1. New `vaults/<new-id>/` with new `config.toml` / `persistence.json`. The create wizard starts from the `config.toml` embedded in the zip (note, hint, and the other public settings) and names the vault `{source} backup`. The user can change those fields before create. Registry id is still new.
2. Unpack the zip straight into the new vault’s `store/` (ciphertext only — skip the settings entry — no re-encrypt, no plaintext tree).
3. Unlock uses the **password from when that snapshot was taken** (RF-59: old snapshots keep the old password if the live vault later changes password).

**No in-place restore.** Do not overwrite the live `store/` with a snapshot.

**Identity / AAD:** registry id (`config.toml` / folder name) **may be new**. Do **not** rewrite `vault.header` or chunks on copy (that would break AEAD). Bind AAD to a **content identity** stored in the header and copied with the snapshot — not to the registry slug, so a backup becomes a new list row without rewriting ciphertext.

### Storage modes

Rest is always `store/`; `.7z` is an **action** (import/export), never kept at rest. A mode only says **how the vault is open**:

| Mode | Id | While open | At rest |
|------|-----|------------|---------|
| **Default** | `encrypted_dir` | Decrypt in RAM only. **Desktop:** FUSE (Linux) / WinFsp (Windows) folder. **Mobile:** in-app file manager (same session — no OS mount). | `store/` |
| **Large / not recommended** | `upriv_plain` | Real plaintext `workspace/` (UI warning): the files the person sends there, or every file with `plain_files = "whole"` | `store/`; wipe workspace on close |

**States:** `open` is a **runtime session** (unlocked), not a disk enum. Where plaintext lives while open depends on mode — not on “open” itself:

| Mode | While open (plaintext) | At rest |
|------|------------------------|---------|
| `encrypted_dir` (default) | RAM only: FUSE/WinFsp reply buffers (desktop) or in-app file-manager buffers (mobile) | `store/` |
| `upriv_plain` | Real files on disk under `workspace/`, chosen file by file or the whole vault (`plain_files`, not a third mode); the rest stay in `store/` and decrypt in RAM when read | `store/`; wipe workspace on close (Close now removes it with no overwrite) |

**Mobile is the same vault.** `store/`, header, chunks, import/export, backups, KDF — one `upriv-core` via FFI. There is **no FUSE** on Android/iOS; “open” still means an unlocked session, not a system folder. Do **not** copy the vault into `filesDir` / iOS tmp to fake a mount (plaintext spill). Android vault-root bytes go through SAF (`content://`); chunk I/O must stream, not extract a tree. Opening a file in an **external** app is not a FUSE path — stream (e.g. Android content URI) or refuse; a cache dump is `upriv_plain` behavior.

### On-disk schema

On disk, persistence is only **`closed`**. Lock is always **close**, with one action: `store/` stays, `persistence = "closed"`.

`persistence.json` holds `content_hash` and `last_close_ok_at` (recovery A), plus the record of the vault's backups: `backup_folder_id`, `backups_written`, and one `backup_hosts` record per machine (`chosen_dir`, and `index_hash` / `stamp` for `skip_unchanged`). `open` is session, not a persisted enum.

**`content_hash`** = SHA-256 of `vault.header` bytes **concatenated with** the primary sealed index (`root.idx.enc`, or `root.idx.enc.copy` when the primary file is absent). Chunk bytes are **not** in the hash. It is a dirty-close / recovery signal, **not** a MAC of the whole tree. Bitrot inside one `*.blob` is a per-chunk tag fail (recovery B), not a `content_hash` mismatch.

The vault list recomputes this hash while the vault is closed. A mismatch uses the same recovery session as a dirty close. `open_vault` still unlocks that `store/`; the next successful close records the hash of the store that was unlocked. Both index files gone under a header that is there is a different store too, so its row is recovery and the unlock finds the index lost (case C). A missing `content_hash`, or any other read error while hashing, does not select recovery. `persistence.json` is ordinary files beside `store/`, so this catches a replaced folder (including a backup unpacked over the live store). It is not a MAC: someone who can edit both the store and the hash can make them match.

### Recovery

| Case | What happened | UI |
|------|----------------|-----|
| **A — Dirty close** | Crash or kill while open (`state.json` still records the session, no live lock), or `store/` differs from the last close (`content_hash` mismatch) | Vault **recovery**: last close did not finish. Offer **unlock the encrypted vault** (`store/` as last flushed). Create-from-backup belongs to case **C**, not as a peer here. Never in-place overwrite live `store/` with a snapshot. |
| **B — Missing or damaged file** | Bitrot in one blob (tag fail), or a blob gone or cut short | Vault **opens**; only **that file** fails. Its index node is marked `missing` or `damaged` (sealed with the index, not vault content): unlock marks a blob that is gone, a read marks what it finds, and a whole read that succeeds, a rewrite, or emptying the file clears it. The file manager marks the file and the folders above it and can show only those files. The file stays until the person deletes it; the editor points to Backups (a new vault from a backup), and there is no repair flow. Not vault-level recovery. |
| **C — Header or index dead** | Cannot unlock, or both index files fail to open | A dead header: only **create vault from backup / store `.zip`**. Both index files dead or gone under a header that opens (`vault_index_unreadable`): the row turns to recovery, the unlock window keeps the password and offers **Rebuild from its own data** (below), and a backup still makes a new vault. One damaged header file or one damaged index file is restored on open. |
| **Set-aside data** | A blob in `data/` no file names: a save cut short, a seal that did not reach the disk, or an older index that came back | Vault **opens**. The unlock moves it to `held/` and records it (see the shipping protocol). The file manager shows a line and a review window laid out like Backups: a file another index, the blob's own record, or a backup names can be put back or deleted, and a piece nothing names can be deleted, one by one or for every chosen item at once (select all). Nothing is deleted for the person. Not vault-level recovery. |
| **D — `upriv_plain` crash** | Leftover plaintext folder; `store/` holds every change saved before the crash | Vault **recovery**: leftover clear files from the last session. One action, **Remove the folder**: wipe it and keep `store/` (files never saved into the vault are lost). Unlock refuses until then (`plain_leftover`). |

Do not invent a second body or a 7z repair picker.

**Rebuild from its own data (`vault_rebuild`).** Only the person starts it, from the unlock that found both index files dead, on a closed vault, as a job with no time limit (the row shows `recovering`). An index that opens is refused (`vault_index_readable`): it is the tree, and a rebuild would lose what only it holds. The password unlocks the header under the open throttle. A Stored copy of `store/` as it is goes into `saves/` of the data folder first (of the chosen backup folder only when the data folder has no room), where retention never rotates it and it stays until the person deletes it, after a check that the drive has room (`vault_rebuild_space_short` with the bytes needed and free); its index files do not open, so the check that they hold one tree is left out, and a vault made from that copy rebuilds the same way. Then every blob is named by the newer of two sources: its own newest record (see Recovery records; a blob whose last bytes are no record is searched whole), and the newest backup zip, in the data folder or the chosen folder, with the same content identity whose tree names it and whose first chunk opens from it. The higher save number wins, the backup on a tie, so a file renamed since its record takes its name from the backup, and a blob with no record still comes back. The tree is built newest first by save number, then time; each file at its path with the folders above it; a path a newer file took, or one under a file, is left. The tree is sealed into both index files, `persistence.json` takes the new content hash and drops each machine's backup record, and `vault_rebuilt` logs counts only (files placed, how many came from a backup, how many were left). No blob is moved, rewritten, or deleted: a blob nothing places stays in `data/`, and the next open sets it aside in `held/`, named by its own record or a backup when one names it. A stop before the seal removes the copy and leaves the store as it was; the seal refuses a stop. Once the seal lands the app opens the vault with the password the rebuild used, so it is ready at once; the toast reports the files placed and those left for review. A rebuilt file holds what its record or backup names, so it may be older than it was: what a session wrote after that, with no close, is not in it, and a part that does not open marks the file on its first read (recovery B). Empty folders and empty files have no blob and do not come back.

**Not modes:** import/export (`.zip` of `store/` **Recommended**, `.7z`, or plain-text `.zip`), in-app backup (`<stamp>-<id>.zip`), create-from-backup. Available in both remaining modes.

### Export is per vault, or the whole data folder

A vault export copies **one vault at a time** from that vault’s row (`.zip` of `store/`, `.7z`, or plain-text `.zip`). There is no zip of a chosen set of vaults.

**Export data folder** (the Export a copy choice in the Data folder modal, always of the data folder in use) is the one whole copy: `<name>.zip`, Stored, no zip password, holding `<name>/<folder>/.upriv/`, the same pattern as a vault export: the typed name names the zip and its outer folder, and the data folder inside keeps its own name (`Upriv` on a phone, whose data folder is a storage-access tree with no path, and for a folder whose name some system cannot hold). The name starts as `upriv-YYYY-MM-DD-HHmmss` (UTC) and the person may change it. Core refuses a name some system cannot hold (path separators, `<>:"\|?*`, control characters, a leading dot, a trailing dot or space, a Windows device name, over 200 bytes) and never replaces a zip, or a partial one, already using that name. Unzipped, the inner folder is chosen in Data folder as it is. It copies every file under `.upriv` as it sits on disk (`store/` ciphertext, backups, settings, groups, logs, `state.json` with its recovery records) and never decrypts. The Include backups switch, on by default, leaves out each vault's `backups/` when off. Backups in a chosen folder are outside `.upriv`, so no copy holds them, and the window counts the vaults that keep some there. It leaves out the `runtime/` locks and unfinished writes (`*.tmp`, `*.tmp.*`, `*.partial`, `*.upriv-part`), and refuses a symlink or a special file. Every vault must be closed or in recovery (`data_folder_busy` otherwise). Core holds each vault for the whole copy, and refuses a new vault, an import, a backup delete or pin, a second export, and a data-folder switch until it ends (`data_folder_export_busy` / `vault_root_busy`). The zip is written beside itself as `.upriv-part` and renamed once its central directory lists every entry. A destination inside a `.upriv` is refused (`export_destination_reserved`). On Android the zip, like a vault export, goes straight into a folder the user picks, mounted for that export as `/upriv-saf-export`; it is never staged in app storage or OS temp.

**This vault must be closed to export.** Close writes the session into `store/`; then copy/stream. An open, opening, closing, or recovery session on **this** vault cannot export. Other vaults may stay open. File zip/7z import and create-from-backup copy a frozen tree; they do not require the source vault closed.

| Format | Closed |
|--------|--------|
| `.zip` of `store/` | Copy `store/` — **no password** |
| `.7z` | Ask password; decrypt from `store/` |
| Plain-text `.zip` | Ask password; decrypt from `store/` |

Do not add a `.7z` kept beside `store/`, a zip of a chosen set of vaults, a lock action other than close, or a storage mode besides `encrypted_dir` and `upriv_plain`.

---

## Bar for a “good” implementation

“It encrypts and decrypts” is **not** the bar. The bar is:

> An attacker with a full copy of the vault volume cannot cheaply test passwords, cannot get plaintext from a truncated/altered blob, and cannot swap metadata (size, chunk index, content identity, algorithm, KDF params) without AEAD failure.

### Argon2id

- Unique **random** salt per vault (never a hash of the password, never reused across vaults).
- Persist algorithm + `m` / `t` / `p` / salt in `vault.header`. **Open always uses those values** on every device. An offline guesser only pays what the header says.
- **Chosen at vault create.** Presets are **not** “phone vs desktop.” The UI states, for each option: **relative resistance to offline password guessing** and **how much RAM unlock needs**. The same vault keeps those params everywhere. If a later device cannot allocate that RAM, open **fails** — do not auto-pick or silently lower `m`/`t`. Upgrade (rewrap with higher cost) is an explicit later action; old snapshots keep the old params (same idea as RF-59 / password).

**Shipping presets** (`p = 1`). Labels in product copy = security + RAM, not device class:

| Unlock RAM (`m`) | `t` | Offline guessing (honest copy) | UI |
|------------------|-----|--------------------------------|-----|
| **32 MiB** | 3 | Weakest of these presets (`m×t` = ⅛ of default). Less-secure opt-in — never auto-pick. | Unlock needs **32 MiB** RAM |
| **64 MiB** | 3 | Same `t` as default; ¼ the `m×t`. We use `p=1` — not RFC 9106’s 64 MiB / `t=3` / `p=4`. | Unlock needs **64 MiB** RAM |
| **128 MiB** | 3 | Half the `m×t` of the default. | Unlock needs **128 MiB** RAM |
| **256 MiB** (create default) | 3 | Default. Does not stop a weak password. | Unlock needs **256 MiB** RAM |
| **1 GiB** | 1 | ~4× RAM per guess (harder parallel/GPU); only ~1.3× `m×t` because `t` drops to 1. | Unlock needs **1 GiB** RAM |
| **2 GiB** | 1 | Highest RAM here; ~2.7× `m×t`. Same `m`/`t` as RFC’s first option, but `p=1` not `p=4`. | Unlock needs **2 GiB** RAM |

256 MiB does **not** “prevent brute force.” A short password is still cheap in wall-clock if the attacker accepts 256 MiB per try. It **does** make GPU/ASIC guessing much more expensive than 7-Zip’s KDF and than a few-MiB Argon2. Password entropy still dominates. A new password that is objectively poor gets one line of warning (SDD §3.2.3b); Upriv never rates a password and never refuses one.

- **Forbidden:** dropping to a few MiB because the UI feels snappy; auto-selecting a preset from “we are on mobile”; auto-downgrading the header on open.
- Do not reuse one derived key for wrapping + content + names without HKDF (or equivalent) domain separation.

### Surface anti-brute-force (official `open` only)

Throttle **wrong-password** attempts in **`upriv-core`**, in the **live process** (daemon / FFI session). Same path for desktop, mobile, and RPC. Not a renderer debounce. **No attempt counter in `persistence.json`.**

- Serialize unlock for that vault (one `open` at a time in this process).
- **Rate:** **5** failed unlocks in a **60 s** window → **block** further `open` for that vault for **60 s**. Then the window can start again. Success clears the in-memory state.
- Do **not** brick the vault forever. Closing Upriv **resets** the throttle (no disk memory of failures).

**Honest scope:** extra friction while **this Upriv is running**. Expected bypass: quit and reopen the app, patched binary, or Argon2 against `vault.header` without the app. Offline disk theft still only pays the **header KDF**. Do not ship copy that this “prevents brute force.”

- **Forbidden:** implementing this only in TypeScript / Electron / Expo; using a plaintext JSON counter as if it were a security boundary.

### XChaCha20-Poly1305

- Use a **mature library** (e.g. libsodium / `crypto_aead_xchacha20poly1305_ietf_*` or the Rust equivalent). **Do not** implement ChaCha/Poly1305/XChaCha by hand.
- 192-bit nonce from a **CSPRNG**. Random nonces are why we picked XChaCha; they do **not** make `(key, nonce)` reuse safe.
- **Never** reuse `(key, nonce)` (RFC 7539: reuse can leak plaintext XOR). One nonce per sealed chunk/message.
- Verify the tag **before** any plaintext is returned to the mount, UI, or export pipe.
- Truncated ciphertext, swapped chunks, or truncated files → typed error, not partial decrypt.

### Authenticated associated data (AAD)

Every AEAD must bind protocol context. **Wrap and index** bind: format version, **content identity** (not the registry folder id), algorithm identifiers, KDF `m`/`t`/`p`/salt, `kind`. **Chunks** bind format version, content identity, `file_id`, `chunk_index`, `chunk_len`, and a per-write `version` (8 CSPRNG bytes, written as 16 lowercase hex digits in the index and the AAD; an index holding anything else does not open). They do not bind salt/`m`/`t`/`p` or `file_size`. **Recovery records** bind format version, content identity, algorithm, `kind` `"record"`, the blob's `file_id`, and `seq`, the record's place in its blob, so a record moved to another vault, blob, or place in the chain does not open; like chunks, they do not bind the KDF params, so a password or unlock-RAM change keeps them.

Unauthenticated header fields that change how the rest is interpreted are a protocol bug.

**Serialization (frozen for this format):** AAD is `serde_json::to_vec` of a **dedicated struct**. Byte order = **struct field order**, compact JSON, no extra spaces. It is **not** the pretty-printed `vault.header` on disk and **not** RFC 8785 / sorted-key JSON. Reordering fields, renaming keys, or switching to a sorted map breaks every vault this build writes. Golden vectors live in `store/header.rs` (`aad_bytes_are_struct_field_order`). Do not “fix” this to canonical JSON without a version bump. There is no reader for any other version.

### Format / ops

- Version the store format; never silently accept unknown versions.
- Fail closed on wrong password, corrupt header, missing chunks, tag mismatch.
- Crypto, KDF, and wipe live **only** in `upriv-core` — not TypeScript, not Electron main, not the Expo module beyond FFI.
- Password never on `7zz` argv, never in logs, never in `localStorage`.
- Header wrap of keys is itself AEAD, not “XOR and hope.”

### Shipping on-disk protocol

This is the only store format (`format_version` 1).

| Piece | Value |
|-------|--------|
| Header files | `store/header/vault.header` and byte-identical `store/header/vault.header.copy` — **JSON** (UTF-8), versioned (`format_version`). `warning` is not in the wrap AAD. Open uses the copy when the primary file is unusable, or when its sealed key fails and the copy opens with the same password. A successful open rewrites the file that did not match and logs `vault_header_restored` with the vault id and the file name. |
| Content identity | UUID in the header; copied with backups/packages; **not** the registry folder id |
| Chunk size | **256 KiB** logical plaintext per chunk (last chunk may be shorter; empty file = no data chunks) |
| Chunk bytes | `store/data/<hh>/<file_id>.blob` (`<hh>` = first two hex digits of the id) — one OS file per logical file. Chunks are concatenated `nonce \|\| ciphertext \|\| tag`. The index stores each chunk's byte offset. A rewrite writes the new ciphertext into a free span, or appends one. Before the index that names new bytes is sealed, each blob written is flushed, then each shard folder that holds a new blob, then `data/`. A blob whose flush failed, or that sits under a folder whose flush failed, is never flushed again: its files are copied to a new blob before the next seal, a marked file included. A chunk the copy cannot read takes a slot of zeros under a fresh version, whose tag never checks out, so it stays damaged and the readable chunks stay readable. Bytes the sealed index still names are not overwritten, nor is the blob's newest recovery record. After that seal, dead ciphertext is packed into a new blob when the waste is large enough to be worth a copy; older records count as waste, the newest does not. |
| Recovery records | Appended to a blob after the chunks it names, each followed by a 20-byte footer, the only part readable without the key: magic `UPRR` ‖ `seq` u32 LE ‖ record length u32 LE ‖ end of the previous footer u64 LE (0 for the first). A record is the file's index entry (`VaultNode`: path, file id, size, chunk versions and offsets, times, digest; never the problem mark) with the content identity, the save number of the seal it was written for, and when, sealed with XChaCha20-Poly1305 under the record key. A blob gets one at the seal that first names it (a whole-file write, an import, a pack, a copy) and one at the close of each session that wrote to it since its last one, appended before the blob's flush, so it is on disk before the index that names that entry. An import writes that first record in the worker that wrote the blob, before that worker's flush, with the save number the next seal takes; when it cannot, the seal that names the blob writes it. Mid-session seals of an existing blob write none: a record lists every chunk, so one per seal would grow with each batch of a large file. A record that cannot be written is logged (`vault_blob_record_failed`) and the seal goes on. Records are never rewritten; a rename writes none, so a record keeps the path of its last write. Normal opens, reads, writes, and exports never read them: they serve set-aside naming and the rebuild only, decrypted before parsed, then checked (same vault, file id equal to the blob's name, a valid store path, chunk lists that match the size, every chunk before the record, no problem mark). Someone with the disk can put back an older blob with its older record, which is why only recovery reads them and a rebuild runs only when the person asks. |
| Index | `store/index/root.idx.enc` and byte-identical `store/index/root.idx.enc.copy` — AES-SIV sealed tree. The copy is written first; the primary file is the commit. A seal that fails leaves the previous primary, so its change is undone and its new blobs deleted. A primary in place whose folder flush failed is kept, and every byte the previous index names stays until a later seal flushes, since a power cut may bring that index back. The blobs such a seal let go are listed in the sealed index (`released`), written again at once with the list, and the first seal that flushes deletes them, in that session or the next. A failed flush is never retried. Open uses the copy when the primary does not unseal, rewrites a file that does not open, and logs `vault_index_restored`. A copy that opens with another tree is kept until the next seal: only it may name the blobs of the seal that stopped. A file that unseals but holds a tree Upriv's edits never make counts as one that does not open: a path with an empty, `.` or `..` part, a leading `/`, a `\` or a NUL; two nodes on one path; a node with no folder above it; two files naming one blob. The error names the node by its place in the list, never by its path. Every edit keeps those rules, so no path reaches a plaintext folder, a mount, or an export unchecked, also from a store zip someone else sealed. Logical names never appear as plaintext paths under `data/`. The sealed tree counts its seals (`saves`, one more each seal, a failed one included), and each recovery record carries the number of the seal it was written for, so a rebuild orders two records of one path without trusting a clock. When neither file opens under a header that does, the open fails with `vault_index_unreadable`. |
| Held | `vaults/<id>/held/`, beside `store/` — blobs no file of the tree names, moved out of `data/` by the unlock that opens a session or comes before a password or unlock-RAM change (export and probes leave `data/` as it is). A blob the index lists as `released` is an old version waiting for a seal that flushes and stays in `data/`, unless the other index file names it: then it holds that tree's bytes and is held like any other. A blob too short to hold one chunk is deleted. The sealed index records each one (`held`), with the file it holds when something else of the vault names its id and its first chunk opens: the other index file, then the blob's own newest recovery record, then the backup zips, newest first, with the same content identity. Chunk AAD binds a version only an index or a record holds, so a blob none of them names cannot be read and stays as an unnamed piece. Only the person deletes a held blob or puts it back; a held blob the tree names again goes back to `data/`. The folder is removed once nothing is in it. Backups and store zips copy `store/` only; Export data folder copies `held/` as ciphertext. |
| Wrap | Argon2id (`m`/`t`/`p` + 16-byte salt from header, version **0x13** hardcoded) → 32-byte KEK → XChaCha unwrap of 32-byte master. Blob = nonce(24) ‖ ct ‖ tag(16) |
| HKDF | SHA-256, `salt=None` (IKM is CSPRNG master), info `upriv-content-key-v1` (32 B) / `upriv-index-key-v1` (64 B) / `upriv-record-key-v1` (32 B) |
| AAD JSON | Compact `serde_json` of a dedicated struct in **field order**. Not pretty `vault.header`, not RFC 8785. Golden vector in `header.rs`. Chunk AAD omits KDF params and `file_size` |
| KDF bounds on open | `m` **32 MiB..=2 GiB**, `t` **1..=16**, `p` **= 1**. Out of range → fail closed **before** Argon2 (malicious header DoS) |
| Argon2 version | **0x13** hardcoded; not in header/AAD. Changing it is a format bump |
| Unknown `format_version` | Fail closed |

**Open session (same `store/`, different presentation):**

| Platform | How the user sees files |
|----------|-------------------------|
| Linux desktop | FUSE mount |
| Windows desktop | WinFsp |
| Android / iOS | In-app file manager; decrypt chunks into RAM; **no** OS FUSE. Android vault-root bytes via SAF — never copy the vault to `filesDir`. |

**v1 delivery** can still land Linux first, then Windows, then mobile FFI — the **format** is shared from day one.

---

## Glossary

**Plaintext** — the vault bytes the user means (file contents, names in the logical tree).  
**Ciphertext** — those bytes after AEAD: unreadable without the key. On disk that is `wrapped_master_key_b64`, `*.blob`, `root.idx.enc` and `root.idx.enc.copy`. Seeing ciphertext is expected; it is not the secret.  
**Nonce** — a number used **once** with a given key (“number used once”). XChaCha mixes it with the key so each message gets a unique keystream. It is **not** a password and is stored next to the ciphertext (public). **Never** reuse `(key, nonce)`.  
**AAD** — extra bytes the tag covers but that are not the file body (chunk index, content identity, sizes, KDF fields). Without AAD, swapping blobs can still “decrypt”.

## Protocol / I/O bugs (password not required)

Closed `store/` + a correct protocol → attack is password guessing (Argon2). These bugs let an attacker **skip** that, or skip our product promise. Round-trip encrypt/decrypt does **not** catch them.

| Bug | What goes wrong |
|-----|-----------------|
| **`(key, nonce)` reuse** | Two messages, same key + same nonce → XOR of ciphertexts leaks XOR of plaintexts; Poly1305 can be forged. Use a CSPRNG 192-bit nonce **per** wrap/chunk. Zero/password-derived/tiny-counter nonces are forbidden. |
| **No AAD** | Each chunk authenticates **alone**. Swap/reorder blobs or (unbound) header fields → decrypt succeeds in the **wrong** place. Bind version, content identity, algos, KDF params, file id, chunk index, sizes. |
| **Plaintext in `/tmp`** | `export_logical_tree` / extract-then-`7zz` writes the logical tree to OS temp. Crash, undelete, other users, swap. Stream only; cancel/crash must not leave an extract (SECURITY-PLAINTEXT). |
| **Password on argv** | `7zz -p…` appears in `ps`, `/proc/…/cmdline`, shell history, audit logs. Pass via stdin / a restricted fd, never argv, never logs. |

`temp/` close/export used tempfile trees and often `-p` on argv, and its `encrypt_chunk` has **no AAD** — **do not port** either.

### Password, master key, edits, nonces

The password is **not** mixed into each file. It unlocks a random master key **once** per open. Saves use the derived **content key** plus a **new nonce**.

**Normalization (fixed before Argon2id lands):** the bytes passed to the KDF are **exactly as typed** — no `trim()`, no silent Unicode form unless we later adopt **NFC applied identically** on create and unlock, on every platform. `trim()` is allowed **only** to detect an empty field (`if (!password.trim())`). Mocks and UI must follow this rule so they are not copied into `upriv-core` later. A mismatch between create and unlock is permanent data loss (no password recovery).

```text
password → Argon2id (header salt + m/t/p) → KEK → unwrap MASTER KEY
         → HKDF → content key (XChaCha chunks) + index key (AES-SIV)
                  + record key (XChaCha recovery records)
```

| When | Argon2? | Nonce? |
|------|---------|--------|
| **Open** | Yes (once) | **Read** nonce already stored on wrap + each chunk. Do not generate. |
| **Edit / flush chunk** | No | **Generate** 192-bit CSPRNG nonce, encrypt, store `nonce \|\| ciphertext\|\|tag`. Unchanged files keep old blobs. |
| **Close** | No | Only dirty objects get new messages (new nonces). Then wipe keys from RAM. |
| **Change password / unlock RAM** | Yes, twice, sequential (old KEK, then new KEK). The unlock gate is held only for each derive. | New wrap nonce and a **new salt**. The **same** master key, so chunks stay. Header wrap and the name index are resealed (both bind salt/`m`/`t`/`p`). Chunk AAD already omits those fields and `file_size`. Do not put them back. A change that would change nothing is refused first; the same preset is refused from the header, before any unlock. A safety zip of the current body goes to the data folder before the change writes anything to `store/` (to the chosen backup folder only when the data folder has no room), so a refusal or a failed zip leaves the vault as it was. It is removed once the change commits, a failed change keeps it, and a stop removes it. Only the unlock may repair a header or index file that does not open from its twin, as every unlock does. Then blobs no file names are set aside, as an open does, because the resealed index replaces the index copy, and the header commits. |

Editing does **not** weaken XChaCha or “re-run Argon2.” Primitive fatigue is not a thing. Bugs on this path are **ours**: nonce reuse, plaintext staging, missing AAD, torn `.enc` writes (atomic replace), encrypting with the password instead of the content key.

**Open vault (session):** OS/malware/swap/hibernation/external editors are out of scope for “closed disk + Argon2.” That is not an algorithm hole. `upriv_plain` **is** plaintext on disk while open (user chose it).

**Closed `store/`:** if wrap + AAD + unique nonces + no spill hold, the attack is password guessing. You cannot skip Argon2 by rewriting it; a fake KDF yields the wrong KEK. You cannot brute-force XChaCha’s 256-bit key instead of the password.

### How we avoid nonce reuse

Do **not** keep a reuse list. Do **not** use a RAM counter (crash → restart from 1 → reuse). Do **not** derive the nonce from the password, path, or a 4-byte chunk id.

Use **XChaCha’s 192-bit nonce from a CSPRNG** (`getrandom` / `OsRng`) **per AEAD message** (each wrap, each chunk, each index seal if it uses XChaCha). Birthday collision is ~2⁹⁶ messages for ~50% — irrelevant for vault I/O. Decrypt uses the nonce **prefixed on that blob**, not a newly generated one.

Forbidden: nonce `0`, password-derived nonce, 32-bit counter. Test: many chunks across two vaults → no duplicate `(key, nonce)` (unique random nonces in practice). Residual: a broken OS RNG — not “we forgot to increment.”

---

## Tests that actually matter (RF-55)

Must exist before calling the store “done”:

| Test | Passes if |
|------|-----------|
| Wrong password | No plaintext; no distinguishable panic that dumps keys |
| Flip any byte of a chunk | Tag fail; no partial file |
| Truncate chunk or header | Fail closed |
| Swap two chunks / wrong `chunk_index` in AAD | Fail closed |
| Tamper with header KDF params or content identity | Fail closed |
| Unique salt / unique nonces across two vaults and many chunks | No reuse |
| Close → reopen | Logical tree matches; no durable plaintext (RF-49) |
| Backup snapshot | Copy into a **new** vault’s `store/`; source unchanged; opens with snapshot password |
| Export cancel or crash | No leftover decrypted tree on disk (RF-49) |
| Recovery record moved to another blob, vault, or `seq`; payload that breaks a rule | Ignored; golden `RecordAad` bytes in `header.rs` |
| Both index files dead | Open fails `vault_index_unreadable`; rebuild restores the tree from records, pins a copy first, refuses a readable index |

Fuzz truncated/garbage store dirs. A security pass should hunt protocol bugs, not only happy-path I/O.

---

## Landmines (do not paper over in the UI)

Applied review 2026-09-12. Confidentiality of closed `store/` passed for wrap + index + chunks as implemented. These items are protocol/product work, not “fix XChaCha.”

| Id | Issue | Do |
|----|--------|----|
| **P0** | Chunk AAD must not bind header `salt`/`m`/`t`/`p` or `file_size`. This format (`format_version` 1) already omits them. Wrap and index still bind the KDF params. | Do not add those fields back. Do not add a reader for another `format_version`. Password and unlock-RAM change reseal the header and the name index only, with a new salt and the same master key. Do not rewrite file blobs. |
| **P1** | AAD comment once said maps were sorted. Reality = struct field order. | Do **not** “fix” serialization to RFC 8785. Keep golden vectors. Never reorder AAD struct fields without a version bump. |
| **P1** | `load_header` / `derive_kek` must refuse absurd `m`/`t`/`p` (DoS / OOM). Editing `m` on an existing wrap does **not** cheapen that wrap (AAD + different KEK). | Bounds: `m` in **32 MiB..=2 GiB**, `t` in **1..=16**, `p` **= 1**. Fail closed before Argon2. |
| **P2** | Argon2 version **0x13** is hardcoded, not in header/AAD. | Keep hardcoded + test. Putting it in AAD is a format bump. |
| **P2** | A new encrypt call site with empty AAD is a protocol bug. | `encrypt_xchacha` **refuses** empty AAD. Do not add a silent empty-AAD path. |
| **P2** | crate `aes-siv` 0.7.0 has no public audit (constant-time warning). | Residual. Do **not** replace with hand-rolled SIV or OpenSSL AES-SIV (CVE-2026-45446). |
| **P2** | `content_hash` omits chunk files. | Recovery A signal only. One bad chunk = that file (recovery B). |
| **P3** | `password_hint` in `config.toml` is public. | UI must say so. Do not encrypt the hint without changing the list-without-unlock model. |
| **P3** | `create_empty_store` / `open_store` / `derive_kek` still accept an empty password. User RPC (`create_vault` / `open_vault`) already rejects. | Do not call store APIs from UI without the check. Closing the library API is later (or `cfg(test)` only). |

---

## FAQ (honest answers for product / agents)

### What is KDF here?

**KDF** = key derivation function. The password does **not** encrypt chunks directly. **Argon2id** turns password + salt + (`m`,`t`,`p`) into a KEK; HKDF splits into layer keys; XChaCha seals chunks. Create-time unlock presets are that Argon2 cost.

### Same security as VeraCrypt? Better than 7-Zip?

**No.** Closed-disk residual attack in all three is password + KDF. Upriv primitives are more modern (memory-hard + AEAD vs classic VeraCrypt PBKDF2+XTS and 7-Zip SHA iterations). VeraCrypt has years of operational review; Upriv’s protocol is new and unaudited as a product. AEAD vs XTS is tamper/bitrot behavior, not product equivalence. AES-256 in 7-Zip is not “broken.” Recommended portable file = ordinary `.zip` of `store/` (no zip password). `.7z` is Plan B (weaker guessing). Never pack `.enc` blobs into `.7z`.

### Does Argon2id “stop” brute force?

**No.** It makes each **offline** guess expensive (memory-hard). Weak passwords still lose. The in-app throttle (**5** fails / **60 s** → **60 s** block in `upriv-core` RAM) is only friction while Upriv is running — quit/reopen or attack `vault.header` offline bypasses it. Do not market either as “prevents brute force.”

### 7-Zip ~10⁴ guesses/s vs Argon2id 1 GiB “&lt;100/s”?

**Directionally yes; do not ship exact rates.** 7-Zip’s SHA-256-style KDF parallelizes well on GPU. Argon2id with `m` = 1 GiB needs ~1 GiB **per** try, so GPU swarms collapse; a normal PC is often **a few tries/s or less**, not “almost 100.” Fat servers can parallelize by available GiB. Measure if you quote numbers; password entropy still dominates.

### Can we free the 1 GiB immediately / skip holding it?

**During Argon2:** the implementation must **allocate and use** ~`m` bytes for the whole derivation. Early free or a fake low-RAM path is an optimization an attacker uses too — the hardness disappears. **After** Argon2 ends, done or failed: wipe and free that buffer (`Argon2Memory` in `store/kdf.rs`, one `zeroize` pass over the blocks), since its last block is one hash away from the KEK. The vendored `argon2` crate runs with its `zeroize` feature, so it also wipes its own starting hash and block hashes. The wipe comes after the derive and takes nothing from the memory and passes a guess pays. The open session keeps only small keys, not 1 GiB for the whole time the vault is open.

### Is Argon2id internationally accepted as secure?

**Yes, as the current password-hashing / password-KDF default when available.** Winner of the 2015 Password Hashing Competition; IETF **[RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)** (recommends **Argon2id**; first option ~2 GiB / `t=1`, second ~64 MiB / `t=3`); **[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)** prefers Argon2id. Security still depends on parameters + password. Some **FIPS**-only environments still require PBKDF2.

### After Argon2 hands a key to XChaCha, can the key leak?

**Yes — while the vault is open, keys live in RAM.** That is required for decrypt/encrypt; it is not an Argon2→XChaCha protocol hole. Correct lifecycle: wipe the Argon2 working buffer after derive; hold master/content keys only for the session; wipe on close. Residual leaks (malware, debugger, swap, hibernation, crash dumps, cold boot) are **open-session OS** threats — out of scope for “closed `store/` + Argon2.” Closed disk → attack is password guessing on the header KDF, not skipping to brute-force the 256-bit XChaCha key.

---

## Agent rules

1. Do not invent a second cipher/KDF “for fun.” Store = Argon2id + HKDF + XChaCha20-Poly1305 + AES-SIV names as specified.
2. Do not implement primitives; call a reviewed crate/API. Vault crypto crates are **vendored** at [`dev/vendor/`](../dev/vendor/) (`[patch.crates-io]` in `dev/Cargo.toml`). Do not `cargo update` Argon2 / AEAD / AES-SIV / `rand` without copying a new snapshot (checklist in `dev/vendor/MANIFEST.txt`) and reviewing `src/` against crates.io. Do not `cargo generate-lockfile` for that. Do not edit `vendor/*/src` except in that reviewed upgrade. `dev/.cargo/config.toml` sets `aes_armv8` on aarch64, the vendored `aes` cfg for ARMv8 AES instructions picked at run time; it changes speed, not bytes (`aes_siv_seals_the_same_bytes_on_every_aes_backend`). ChaCha20 stays on its software backend on ARM: `chacha20` 0.9 marks NEON nightly-only.
3. Do not treat `.7z` as the vault’s security story or as the backup format. On disk a backup is `<stamp>-<id>.zip` in the vault's backup folder (pin: `saves/<stamp>-<id>.zip` there): a **Stored** zip of `store/`, no zip password, no unpacked tree, no `.7z`. Backup export copies that file into a chosen folder, or bundles several of them into one Stored zip; while it reads a backup, delete, pin, and retention leave that backup alone. The portable export of the live vault is a separate `.zip` of `store/` (Recommended) or `.7z` (guessing warning). Restore = new vault from a backup zip, a store zip, or a `.7z`.
4. Argon2id cost is chosen **at create** (default **256 MiB / 3 passes**). Shipping presets include **32 MiB** (less-secure opt-in) and **128 MiB** (mid). Presets are security + unlock RAM, not device type. Never auto-select or downgrade the header from the current OS.
5. Do not ship store I/O without the tamper/truncation tests above.
6. For rest layout, backups, and storage modes (`encrypted_dir` + `upriv_plain` only), **this file wins** over PRD/SDD.
7. Plaintext vault bytes on ordinary disk **only** if the user chose `upriv_plain` and the vault is open. The one trace past that is the unallocated space Close now leaves, which the person chose behind its warning. Transitional phases (import, export, backup, password, recovery) must stream or copy ciphertext — never a convenience extract.
8. Surface anti-brute-force lives in **`upriv-core` RAM**: serialize `open`; **5** failures in **60 s** → **60 s** block. Not the UI, not a JSON counter. Do not market it as stopping offline guessing.
9. Password unlocks the master key **once** per open. Saves = content key + new CSPRNG 192-bit nonce, not Argon2. Never RAM counters or password-derived nonces. Close flushes with those session keys and does not ask for the password. Open-session OS leaks ≠ “XChaCha failed while editing.”
10. One store format. Do not add a reader for another `format_version`. Do not put KDF salt/`m`/`t`/`p` or `file_size` into chunk AAD. Password and unlock-RAM change keep this chunk AAD and the same master key. Do not reorder AAD struct fields. Do not claim VeraCrypt equivalence or “prevents brute force.”
11. Header `m`/`t`/`p` out of shipping bounds → fail closed. Do not lower `m` to make open snappy (that is the attacker’s optimization).
