# Store crypto — Argon2id + XChaCha20-Poly1305

**Audience:** anyone implementing vault store, backups, key wrap, or `.7z` export in `upriv-core`.  
**Status:** implementation invariant **and** the bar for shipping `store/`. `dev/` has one store format (`format_version` 1): a header that holds a keyring + AES-SIV index + XChaCha chunks, and every blob carries a key copy and recovery records (create writes a seed file). Chunk AAD does not bind KDF params. A password change (`vault_change_password`) makes a new key and rewrites every file with it, file by file, so after it and its pass nothing in the vault opens with the old password; an unlock-RAM change (`vault_change_kdf`) keeps the keys and updates every blob's key copy. Both need the vault closed and run as jobs. Any other `format_version` fails closed as an unreadable store.

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
| **Argon2id** | Password → KEK that unlocks the header's keys. Memory-hard; GPU/ASIC guessing is expensive when `m` is large enough (RFC 9106). |
| **HKDF** | Split each random **key** of the keyring into **independent** keys (content + index + recovery records). Wrap uses the Argon2 **KEK**, not an HKDF arm. Never use the raw Argon2 output as every layer’s key. |
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
Argon2id  (unique random salt; params stored in the header block)  →  KEK (wrap only)
    │
    ▼
unwrap the keyring (XChaCha20-Poly1305 + wrap AAD): generation, since, keys by id
    │
    ▼  for each key
HKDF-SHA256 (IKM = that key, salt = None, RFC 5869)
    ├── info "upriv-content-key-v1"  → content key (XChaCha chunks)
    ├── info "upriv-index-key-v1"    → index key (AES-SIV)
    └── info "upriv-record-key-v1"   → record key (XChaCha recovery records)
```

Wrap uses the Argon2 **KEK**, not an HKDF output. HKDF `salt=None` is intentional: IKM is a 32-byte CSPRNG key. Do not add a public HKDF salt without a `format_version` bump. A read picks each chunk's key by the id its index entry names; a write uses the **write key**, the newest key of the block.

**At rest:** `store/` only (`vault.header` + `index/` + `data/`). Lock = close.  
**On-disk zones:** plaintext `config.toml` + `persistence.json` at `vaults/<id>/` (list/name **without** the password). Ciphertext only under `store/`.  
**Snapshots (backup):** a `<stamp>-<id>.zip` in a vault's backup folder (or in `saves/` there, also as `<stamp>-<id> <name>.zip` once the person named it) is a **Stored** zip with `README.md` and `config.toml` (the public vault settings, plus a comment naming the unlock preset) beside `store/` (`header/`, `index/`, `data/`, and `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md`). `README.md` records the UTC time that copy was written and the rounded size of the files in `store/` (not the exact length of the zip). No zip password. Close writes one when `[backup] enabled`. Close now writes none, and the next normal close does, because the last backup still differs from the vault. `skip_unchanged` defaults on and skips that zip when the vault files match this device's last backup and that zip is still in the folder in use (or that folder cannot be reached to tell); `.upriv-workspace.json` is not a change. Off writes a zip on every close. Copy ciphertext; do not decrypt-then-re-encrypt. Unpack copies the ciphertext tree (`header/`, `index/`, `data/`). `README.md` and `config.toml` stay beside `store/`. The new vault writes its own `config.toml` beside `store/`, and writes `DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md` into `store/` when that store is created. Export and backup write that same file before packing, so the zip keeps it inside `store/`. Kind = path (the backup folder vs `saves/`); time = the stamp in the file name (the same instant as `README.md`), which the UI shows.

**Backup folders.** Each device keeps its own lists of backup folders: the app's (`[backups.devices.<id>]` in `settings.toml`: rows, then Data folder) and each vault's (`[backup.devices.<id>]` in `config.toml`: rows, then Use the app's, then Data folder). Data folder is `.upriv/vaults/<id>/backups/`. A vault's row writes to `<row>/upriv-<folder id>-backups/`, an app row to `<row>/upriv-backups/<folder id>/`, and a row already ending in that name is not nested. `<folder id>` is the vault id at the first backup there, kept in `persistence.json`, so a rename keeps finding them. A row's folder holds the same ciphertext zips. It is never inside a `.upriv`, and never inside an `upriv-unlocked` folder of this device's unlocked folder rows, nor the other way round, because a plain-text close wipes its folder (`folder_overlap`, checked on save and on copy). A row's own folder is never created, so an unplugged drive does not become a new folder on the local disk: only Upriv's subfolders are made, and a vault folder this device wrote to before that is gone reads as a drive that is away, until the person selects that row again (`reuse` on its reference).

A close and Back up now write to the folder in use: this device's selection, walked through its chain when it fails (a folder lane thread per folder, within `FOLDER_SWITCH_CHECK_LIMIT`, a limit on the check and never on the backup). Missing, not answering, no permission, no room, and a zip too large for the folder are the folder's failures; the selection then hands over for good to the first choice that works, saved at its level, with a toast. A vault read error or a stop switches nothing. Close now and Stop write no zip. A zip counts once it is read back in full, renamed with no replace (the next stamp when the name is taken), and its folder flushed. A partial zip (`.zip.partial`) Upriv left is removed when Upriv next reaches its folder.

Every zip gets a reference in `persistence.json` (`backup_folders`: `ref`, `device`, `system`, `dir`, `reuse`; the data folder is `data`), and a backup key names its folder by reference (`<ref>/<file>`, `<ref>/saves/<file>`). Writes and rotation happen only in the folder in use, and automatic deletion touches only the zips named in `backups_written` (in write order), so zips from a restored copy, zips made by hand, zips in a folder no longer in use, and the person's own files are never deleted automatically. A reference counts as the folder in use when its `dir` is that folder on this device and the zip is there, whichever device wrote it. A zip that cannot be checked does not count toward `keep_last`, so a reachable zip is never deleted on the strength of one Upriv cannot see. `backup_devices` keeps each device's last backup (`index_hash`, `stamp`, its folder's reference), so skip-unchanged holds per device when a data folder moves between computers. The Backups window lists, per folder, every zip in the data folder and every zip in a referenced folder whose cleartext `store/header/vault.header` carries this vault's content identity; while this vault's own header is dead, every zip there is listed. Zips in a folder no longer in use stay listed, and references go once their zips are gone; a folder that cannot be reached can be forgotten (`backup_folder_forget`), and its files stay. Naming a backup (`backup_rename`) is one rename into `saves/` under the vault's directory lock, refused while that backup is being exported; the name is readable without the password, like the vault's note. Deleting a vault leaves backups outside the data folder alone unless the person turns on its switch, which removes the zips that vault wrote there and then the folders left empty, after the vault is gone; a drive that cannot be reached keeps its zips and does not stop the delete.

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

**`.upriv-config/`:** a folder in the package folder of a `.7z` or a plain-text `.zip`, beside the vault folder, which holds the vault's own files and nothing else (`My notes-plain-text/.upriv-config/` beside `My notes-plain-text/my-notes/`). It holds `config.toml` (the same bytes a store zip carries), `.upriv-workspace.json` (the file manager workspace, under its name in the vault), and a `README.md` that explains the folder. An export writes each file only when its toggle is on (both start on), and writes no folder when neither is. In a `.7z` it is the first block, with its own salt and IV, so a password test reads the settings without decoding a vault file, and finds the vault folder from the names of every member; `config.toml` is read to its end, so its checksum also checks the password when file names are not encrypted. Importing works with any of it missing. Settings reach the new vault through the create wizard: a `.zip` shows them when it is picked, and a `.7z` when its password test passes, so the fields they can fill stay locked until then. The workspace goes back to `.upriv-workspace.json`, and a kept workspace means no welcome note. The folder is never stored: the name is reserved in a vault at any depth, and every import skips it anywhere but beside a package's vault folder, also in an unpacked export brought in as a folder.

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

Same as **create from a store `.zip`**: **new vault**, source unchanged. The snapshot **is** that zip (`<stamp>-<id>.zip`, or in `saves/` there, in the data folder or a backup row's folder).

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
| **Large / not recommended** | `upriv_plain` | Real plaintext in its unlocked folder (UI warning): the files the person sends there, or every file with `plain_files = "whole"` | `store/`; wipe that folder on close |

**States:** `open` is a **runtime session** (unlocked), not a disk enum. Where plaintext lives while open depends on mode — not on “open” itself:

| Mode | While open (plaintext) | At rest |
|------|------------------------|---------|
| `encrypted_dir` (default) | RAM only: FUSE/WinFsp reply buffers (desktop) or in-app file-manager buffers (mobile) | `store/` |
| `upriv_plain` | Real files on disk in its unlocked folder, chosen file by file or the whole vault (`plain_files`, not a third mode); the rest stay in `store/` and decrypt in RAM when read | `store/`; wipe that folder on close (Close now removes it with no overwrite) |

**Mobile is the same vault.** `store/`, header, chunks, import/export, backups, KDF — one `upriv-core` via FFI. There is **no FUSE** on Android/iOS; “open” still means an unlocked session, not a system folder. Do **not** copy the vault into `filesDir` / iOS tmp to fake a mount (plaintext spill). Android vault-root bytes go through SAF (`content://`); chunk I/O must stream, not extract a tree. Opening a file in an **external** app is not a FUSE path — stream (e.g. Android content URI) or refuse; a cache dump is `upriv_plain` behavior.

### On-disk schema

On disk, persistence is only **`closed`**. Lock is always **close**, with one action: `store/` stays, `persistence = "closed"`.

`persistence.json` holds `content_hash` and `last_close_ok_at` (recovery A), plus the record of the vault's backups: `backup_folder_id`, the folder references (`backup_folders`), `backups_written`, and one `backup_devices` record per device ID (`index_hash` / `stamp` / the folder for `skip_unchanged`), and `files_bytes`, about what the vault's files hold (recorded when the vault is made, by the rebuild, and at each close, from the index already in RAM, so no chunk file is read). `open` is session, not a persisted enum.

**`content_hash`** = SHA-256 of both header files (`vault.header`, then `vault.header.copy`) **concatenated with** the primary sealed index (`root.idx.enc`, or `root.idx.enc.copy` when the primary file is absent). Blobs are **not** in the hash, and neither is the index copy: the list would read a second index in full, and the unlock picks the right index file anyway. It is one line in `persistence.json`, a dirty-close / recovery signal, **not** a MAC of the whole tree. Bitrot inside one `*.blob` is a per-chunk tag fail (recovery B), not a `content_hash` mismatch.

The vault list recomputes this hash while the vault is closed. A mismatch uses the same recovery session as a dirty close. `open_vault` still unlocks that `store/`; the next successful close records the hash of the store that was unlocked. So a header file that came back from an earlier time, the primary or the copy, shows as a recovery row before the person types anything, and its unlock gives the answers of the unlock rule; no state is stored for it. Any write of a header or index file while the vault has no open session records the new hash in the same step (the four-write header commit and the seal of a closed vault do it), so a password change, Finish, an unlock-RAM change, a rebuild, or a twin repaired by an unlock never leaves a false recovery row. Both index files gone under a header that is there is a different store too, so its row is recovery and the unlock finds the index lost (case C). A missing `content_hash`, or any other read error while hashing, does not select recovery. `persistence.json` is ordinary files beside `store/`, so this catches a replaced folder (including a backup unpacked over the live store). It is not a MAC: someone who can edit both the store and the hash can make them match.

### Recovery

| Case | What happened | UI |
|------|----------------|-----|
| **A — Dirty close** | Crash or kill while open (`state.json` still records the session, no live lock), or `store/` differs from the last close (`content_hash` mismatch) | Vault **recovery**: last close did not finish. Offer **unlock the encrypted vault** (`store/` as last flushed). Create-from-backup belongs to case **C**, not as a peer here. Never in-place overwrite live `store/` with a snapshot. |
| **B — Missing or damaged file** | Bitrot in one blob (tag fail), or a blob gone or cut short | Vault **opens**; only **that file** fails. Its index node is marked `missing` or `damaged` (sealed with the index, not vault content): unlock marks a blob that is gone, a read marks what it finds, and a whole read that succeeds, a rewrite, or emptying the file clears it. The file manager marks the file and the folders above it and can show only those files. The file stays until the person deletes it; the editor points to Backups (a new vault from a backup), and there is no repair flow. Not vault-level recovery. |
| **C — Header or index dead** | Both header files dead, gone, or older than the blobs (`vault_header_unreadable`), or both index files dead or gone under a header that opens (`vault_index_unreadable`) | The row turns to recovery; the unlock window keeps the password and offers **Rebuild from its own data** (below), which brings the header back from the blobs' key copies, the tree from their records, or both. Create vault from backup / store `.zip` is the way back only when no blob's key copy opens. One damaged header file or one damaged index file is written from its twin once a header and an index open together. |
| **Set-aside data** | A file of `data/` no file names: an older index that came back, a blob put in by hand, or a seal that did not reach the disk | Vault **opens**. The unlock that opens a session moves every such regular file, whatever its length, to `held/` and records it (see the shipping protocol). The file manager shows a line and a review window laid out like Backups: a file the blob's own record or a backup names can be put back or deleted, and a piece nothing names can be deleted, one by one or for every chosen item at once (select all). Nothing is deleted for the person. Not vault-level recovery. |
| **D — `upriv_plain` crash** | Leftover plaintext folder; `store/` holds every change saved before the crash | Vault **recovery**: leftover clear files from the last session. One action, **Remove the folder**: wipe it and keep `store/` (files never saved into the vault are lost). Unlock refuses until then (`plain_leftover`). |

Do not invent a second body or a 7z repair picker.

**Rebuild from its own data (`vault_rebuild`).** Only the person starts it, from the unlock that found the header or both index files lost (`vault_header_unreadable`, `vault_index_unreadable`), on a closed vault, as a job with no time limit on the keys lane (the row shows `recovering`). A pending password change settles first, as at an open. A header and an index that open together are refused (`vault_index_readable`): that index is the tree, and a rebuild would lose what only it holds. **The header from key copies:** key copies are grouped by salt and cost, the password is tried on the groups from the highest generation down (8 groups at most), and the first that opens is the vault's header, written as both header files with a generation above every blob's; a password that opens none is `wrong_password`. **Before the tree step**, a header older than one blob's key copy is not used: when the password opens that key copy, the header is read back from the key copies first; otherwise the answer is `password_outdated`. **The copy from before:** after any header step and before the tree step, a Stored copy of `store/` as it is goes into `saves/` of the data folder (of the backup folder in use only when the data folder has no room), where retention never rotates it and it stays until the person deletes it; its index files do not open, so the check that they hold one tree is left out, and a vault made from that copy rebuilds the same way. When it does not fit, or fails for any other reason, the rebuild goes on without it, and the result and the log say why. Then every blob is named by the newer of two sources: its own newest record (see Recovery records; a blob whose last bytes are no record is searched whole), and the newest backup zip, in the data folder or any reachable folder that holds the vault's zips, with the same content identity whose tree names it and whose first chunk opens from it. The higher save number wins, the backup on a tie, so a file renamed since its record takes its name from the backup, and a blob with no record still comes back. The tree is built newest first by save number, then time; each file at its path with the folders above it; a path a newer file took, or one under a file, is left. The tree is sealed into both index files, `persistence.json` takes the new content hash and drops each machine's backup record, and `vault_rebuilt` logs counts only (files placed, how many came from a backup, how many were left). No blob is moved, rewritten, or deleted: a blob nothing places stays in `data/`, and the next open sets it aside in `held/`, named by its own record or a backup when one names it. When only the header was lost and an index opens with the header read back, there is no tree step. A stop leaves the store as the steps before it left it: a header read back stays, and so does the copy; the seal refuses a stop. Once the seal lands the app opens the vault with the password the rebuild used, so it is ready at once; the toast reports the files placed and those left for review. A rebuilt file holds what its record or backup names, so it may be older than it was: what a session wrote after that, with no close, is not in it, and a part that does not open marks the file on its first read (recovery B). Empty folders and empty files have no blob and do not come back.

**Not modes:** import/export (`.zip` of `store/` **Recommended**, `.7z`, or plain-text `.zip`), in-app backup (`<stamp>-<id>.zip`), create-from-backup. Available in both remaining modes.

### Export is per vault, or the whole data folder

A vault export copies **one vault at a time** from that vault’s row (`.zip` of `store/`, `.7z`, or plain-text `.zip`). There is no zip of a chosen set of vaults.

**Export data folder** (the Export a copy choice in the Data folder modal, always of the data folder in use) is the one whole copy: `<name>.zip`, Stored, no zip password, holding `<name>/<folder>/.upriv/`, the same pattern as a vault export: the typed name names the zip and its outer folder, and the data folder inside keeps its own name (`Upriv` on a phone, whose data folder is a storage-access tree with no path, and for a folder whose name some system cannot hold). The name starts as `upriv-YYYY-MM-DD-HHmmss` (UTC) and the person may change it. Core refuses a name some system cannot hold (path separators, `<>:"\|?*`, control characters, a leading dot, a trailing dot or space, a Windows device name, over 200 bytes) and never replaces a zip, or a partial one, already using that name. Unzipped, the inner folder is chosen in Data folder as it is. It copies every file under `.upriv` as it sits on disk (`store/` ciphertext, backups, settings, groups, logs, `state.json` with its recovery records) and never decrypts. The Include backups switch, on by default, leaves out each vault's `backups/` when off. Backups in a backup row's folder are outside `.upriv`, so no copy holds them, and the window counts the vaults that keep some there (from their backup references). It leaves out the `runtime/` locks and unfinished writes (`*.tmp`, `*.tmp.*`, `*.partial`, `*.upriv-part`), and refuses a symlink or a special file. Every vault must be closed or in recovery (`data_folder_busy` otherwise). Core holds each vault for the whole copy, and refuses a new vault, an import, a backup delete or pin, a second export, and a data-folder switch until it ends (`data_folder_export_busy` / `vault_root_busy`). The zip is written beside itself as `.upriv-part` and renamed once its central directory lists every entry. A destination inside a `.upriv` is refused (`export_destination_reserved`). On Android the zip, like a vault export, goes straight into a folder the user picks, reached at its own tree root (`/upriv-saf-tree/<key>`); it is never staged in app storage or OS temp.

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
- **Chosen at vault create.** Presets are **not** “phone vs desktop.” The UI states, for each option: **relative resistance to offline password guessing** and **how much RAM unlock needs**. The same vault keeps those params everywhere. If a later device cannot allocate that RAM, open **fails** — do not auto-pick or silently lower `m`/`t`. Changing the cost is the person's explicit unlock-RAM change on a closed vault; old snapshots keep the old params (same idea as RF-59 / password), and the Backups window marks a backup whose unlock RAM is below the vault's.

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

Every AEAD must bind protocol context. **Wrap and index** bind: format version, **content identity** (not the registry folder id), algorithm identifiers, KDF `m`/`t`/`p`/salt of their block, `kind`. **Chunks** bind format version, content identity, `file_id`, `chunk_index`, `chunk_len`, and the chunk's `version`: the first 8 bytes of `SHA-256("upriv-chunk-version-v1" ‖ nonce)`, written as 16 lowercase hex digits in the index and the AAD (an index holding anything else does not open). A rewrite takes a new random nonce, so a new version, and a chunk put back from an older copy does not match the version the index holds; with the key, a chunk opens from its own bytes. Chunks do not bind salt/`m`/`t`/`p` or `file_size`. **Recovery records** bind format version, content identity, algorithm, `kind` `"record"`, the blob's `file_id`, and `seq`, the record's place in its blob, so a record moved to another vault, blob, or place in the chain does not open; like chunks, they do not bind the KDF params, so an unlock-RAM change keeps them.

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
| Header files | `store/header/vault.header` and byte-identical `store/header/vault.header.copy` — **JSON** (UTF-8), versioned (`format_version`). `warning` is not in the wrap AAD. The **top block** is `generation`, `kdf` (`alg`, `memory_kib`, `time_cost`, `parallelism`, `salt_b64`), `key_ids`, `since`, and `wrapped_keys_b64`; `change` is a second block with the same fields, there only while a password change is pending. `generation` grows with every header write, above every generation the file held, `change`'s included; the copy inside the wrap is the authenticated one, and the clear `generation`, `key_ids`, and `since` let code with no password compare two headers (the unwrap checks they match). A new key takes as its id the generation of the header write that first holds it, so ids only grow and are never reused; keys are listed in id order and the last is the write key. Key id 0 is never a key. A header holds at most 8 keys. A vault is created with generation 1, one key with id 1, `since` 1. **The unlock** (one function, every caller) reads both header files, tries the password on every block they hold (one Argon2 derive per distinct salt and cost), and for each block that opened, newest generation first, tries the index files under the pairs that block may use; the first block that opens an index is the vault's header. A pending change is decided before anything else (see the password change). Nothing is written before a header and an index open together; then the other header file and index file, when they differ, are written from that pair and the open logs `vault_header_restored` / `vault_index_restored` with the file name. |
| Content identity | UUID in the header; copied with backups/packages; **not** the registry folder id |
| Chunk size | **256 KiB** logical plaintext per chunk (last chunk may be shorter; empty file = no data chunks) |
| Chunk bytes | `store/data/<hh>/<file_id>.blob` (`<hh>` = first two hex digits of the id) — one OS file per logical file: a **key copy** (`[0, 4096)`), the file's **chunks** from offset 4096, then its **recovery records**. Chunks are concatenated `nonce \|\| ciphertext \|\| tag`. The index stores each chunk's byte offset and key id. A rewrite writes the new ciphertext into a free span, or appends one; chunk placement treats `[0, 4096)` as taken, and the waste measure counts it as live. A file of size 0 has no blob. Before the index that names new bytes is sealed, each blob written is flushed, then each shard folder that holds a new blob, then `data/`. A blob whose flush failed, or that sits under a folder whose flush failed, is never flushed again: its files are copied to a new blob before the next seal, a marked file included. **One copy rule:** a chunk a copy cannot read is carried into its slot byte for byte with its version, so it stays unreadable and the file keeps its mark; in the copy after a failed flush it keeps its key id, in a password change it takes key id 0 (the key it was written with leaves the vault). Bytes the sealed index still names are not overwritten, nor is the blob's newest recovery record. After that seal, dead ciphertext is packed into a new blob when the waste is large enough to be worth a copy; older records count as waste, the newest does not. |
| Key copy | The first 4096 bytes of every blob: magic `UPRK` (4), content identity (16), file id (16), `memory_kib` / `time_cost` / `parallelism` (u32 LE each), salt (16), generation (u32 LE), key count `n` (u32 LE, 1..=8), then the `wrapped_keys_b64` bytes of the header block it was written under, byte for byte (wrap nonce 24, ciphertext and tag `8 + 36·n + 16`), zeros up to 4096. With bytes 4 to 63 they rebuild the wrap AAD, so the password opens a key copy exactly as it opens that block, and any blob plus the password opens that file. Writing one needs no password: it is copied from a header. A key copy is **good** when its generation equals the header's top block. A blob's writer writes it first, from the block it holds; a seal while `key_copies_due` is on writes the header's key copy into each blob it flushes, with that flush, and reads none; a seal while it is off writes none. **The pass** (the job after an open, `vault_key_copies_update`, or the last step of a change) walks `data/` and `held/`, reads the first 72 bytes of each blob, skips a good one, overwrites one whose generation is below the header's and flushes, never touches one above the header's, and seals `key_copies_due` off at its end; in an open session it goes through the session's `StagedBlobs`, one blob at a time, so a failed flush marks the blob failed and the next seal copies it. A stop or a close ends it where it is; the job after the next open resumes it. Only a failed unlock (72 bytes of up to 4 blobs), the pass, the rebuild, and a recovery tool read key copies; an open, a read, a write, or an export of a vault that opens never does. |
| Recovery records | Appended to a blob after the chunks it names, each followed by a 20-byte footer, the only part readable without the key: magic `UPRR` ‖ `seq` u32 LE ‖ record length u32 LE ‖ end of the previous footer u64 LE (0 for the first). A record is the file's index entry (`VaultNode`: path, file id, size, chunk versions, offsets, and key ids, times, digest; never the problem mark) with the content identity, the save number of the seal it was written for, and when, sealed with XChaCha20-Poly1305 under the record key of the write key at the time it is written; a reader tries the keys it holds, newest first. A blob gets one at the seal that first names it (a whole-file write, an import, a pack, a copy) and one at the close of each session that wrote to it since its last one, appended before the blob's flush, so it is on disk before the index that names that entry. An import writes that first record in the worker that wrote the blob, before that worker's flush, with the save number the next seal takes; when it cannot, the seal that names the blob writes it. Mid-session seals of an existing blob write none: a record lists every chunk, so one per seal would grow with each batch of a large file. A record that cannot be written is logged (`vault_blob_record_failed`) and the seal goes on. Records are never rewritten; a rename writes none, so a record keeps the path of its last write. Normal opens, reads, writes, and exports never read them: they serve set-aside naming and the rebuild only, decrypted before parsed, then checked (same vault, file id equal to the blob's name, a valid store path, chunk lists that match the size, every chunk before the record, no problem mark). Someone with the disk can put back an older blob with its older record, which is why only recovery reads them and a rebuild runs only when the person asks. |
| Index | `store/index/root.idx.enc` and byte-identical `store/index/root.idx.enc.copy` — AES-SIV sealed tree. A file node holds `chunk_keys`, one key id per chunk, beside `chunk_versions` and `chunk_offsets`; key id 0 means the chunk has no key and reads as damaged. The root holds `key_copies_due`, written only when true. **The pair:** the index is sealed with the index key of the header's write key and the AAD of that block, and an index under any other pair does not open, so someone who holds an older key cannot make a tree the vault accepts; while a change is pending, an unlock through the top block accepts only the top block's pair, one through `change` either. The tree check refuses a chunk whose key id is not 0 and is in neither the header's keys nor a pending change's. The copy is written first; the primary file is the commit. When both files open and hold different trees, the one with the higher `saves` is the vault's tree, the primary on a tie. Every seal lists in `released` the blobs it drops, so a crash between its two writes leaves no blob the winning tree neither names nor releases, whichever file wins; the first seal that flushes deletes them, in that session or the next. A seal that fails leaves the previous primary, so its change is undone and its new blobs deleted. A primary in place whose folder flush failed is kept, and every byte the previous index names stays until a later seal flushes, since a power cut may bring that index back. A failed flush is never retried. A file that unseals but holds a tree Upriv's edits never make counts as one that does not open: a path with an empty, `.` or `..` part, a leading `/`, a `\` or a NUL; two nodes on one path; a node with no folder above it; two files naming one blob. The error names the node by its place in the list, never by its path. Every edit keeps those rules, so no path reaches a plaintext folder, a mount, or an export unchecked, also from a store zip someone else sealed. Logical names never appear as plaintext paths under `data/`. The sealed tree counts its seals (`saves`, one more each seal, a failed one included), and each recovery record carries the number of the seal it was written for, so a rebuild orders two records of one path without trusting a clock. When neither file opens under a header that does, the open fails with `vault_index_unreadable`. |
| Held | `vaults/<id>/held/`, beside `store/` — every regular file `<id>.blob` of `data/` that no file of the tree names and the index did not release, whatever its length, moved out of `data/` by the unlock that opens a session or comes before a password or unlock-RAM change (export and probes leave `data/` as it is); Upriv deletes none. Anything in `data/` that is not a regular file is left where it is and logged. A blob the index lists as `released` is deleted only by a session whose unlock marked no file as missing for the first time; when it marks one, the index may be older than the blobs, so the released blobs are set aside like any unnamed blob, taken off the list, and none is deleted. A blob set aside whose key copy is behind the header turns `key_copies_due` on, so the pass gives it the header's: one from an older copy of the vault keeps no earlier key or cost. The sealed index records each one (`held`), with the file it holds when something else of the vault names its id and its first chunk opens: the blob's own newest recovery record, then the backup zips, newest first, with the same content identity. Chunk AAD binds a version only an index or a record holds, so a blob none of them names cannot be read and stays as an unnamed piece. Only the person deletes a held blob or puts it back; a held blob the tree names again goes back to `data/`. The folder is removed once nothing is in it. Backups and store zips copy `store/` only; Export data folder copies `held/` as ciphertext. |
| Wrap | Argon2id (`m`/`t`/`p` + 16-byte salt from the block, version **0x13** hardcoded) → 32-byte KEK → XChaCha unwrap of the keyring: `generation` u32 LE ‖ `since` u32 LE ‖ for each key `id` u32 LE ‖ key 32. `wrapped_keys_b64` = nonce(24) ‖ ct ‖ tag(16); its AAD is `HeaderAad` with kind `wrap`, built from its own block's `kdf` |
| HKDF | SHA-256, `salt=None` (IKM is a CSPRNG key), per key, info `upriv-content-key-v1` (32 B) / `upriv-index-key-v1` (64 B) / `upriv-record-key-v1` (32 B) |
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
**Ciphertext** — those bytes after AEAD: unreadable without the key. On disk that is `wrapped_keys_b64`, each blob's key copy, chunks, and records, `root.idx.enc` and `root.idx.enc.copy`. Seeing ciphertext is expected; it is not the secret.  
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

### Password, keys, edits, nonces

The password is **not** mixed into each file. It unlocks the header's keyring **once** per open. Saves use the derived **content key** of the write key plus a **new nonce**.

**Normalization (fixed before Argon2id lands):** the bytes passed to the KDF are **exactly as typed** — no `trim()`, no silent Unicode form unless we later adopt **NFC applied identically** on create and unlock, on every platform. `trim()` is allowed **only** to detect an empty field (`if (!password.trim())`). Mocks and UI must follow this rule so they are not copied into `upriv-core` later. A mismatch between create and unlock is permanent data loss (no password recovery).

```text
password → Argon2id (block salt + m/t/p) → KEK → unwrap the KEYRING
         → per key, HKDF → content key (XChaCha chunks) + index key (AES-SIV)
                           + record key (XChaCha recovery records)
```

| When | Argon2? | Nonce? |
|------|---------|--------|
| **Open** | Yes (once per distinct salt and cost; one on a steady vault) | **Read** nonce already stored on the wrap + each chunk. Do not generate. |
| **Edit / flush chunk** | No | **Generate** 192-bit CSPRNG nonce, encrypt with the write key, store `nonce \|\| ciphertext\|\|tag`; the chunk's version comes from that nonce. Unchanged files keep old blobs. |
| **Close** | No | Only dirty objects get new messages (new nonces). Then wipe keys from RAM. |
| **Password change** | Yes, twice, sequential (old KEK, then new KEK). The unlock gate is held only for each derive. | A **new key** and a new salt; every chunk is decrypted in RAM and written again under the new key with a new nonce (below). |
| **Unlock-RAM change** | Yes, twice, sequential. | The **same keys**, a new salt and cost; the header and the name index are resealed and every blob's key copy is overwritten by the pass. Chunks stay. |

Chunk AAD omits salt/`m`/`t`/`p` and `file_size`. Do not put them back.

### Password change

Every password change makes a new key and re-encrypts the vault; there is no other kind (`vault_change_password`, a job on the keys lane, no time limit). Core checks, in order: vault closed, no leftover plain-text folder, no change pending, no delete started, new password differs.

1. **Start.** Unlock with the current password under the unlock limit. Free space for the change itself: the largest file to convert, twice the index, and 16 MiB; short of that, `password_change_space_short` with the sizes. With **Back up first** on (each time the window opens), a zip of the store exactly as it is goes into `saves/` (in the data folder, or the backup folder in use when the data folder has no room) before anything in `store/` moves; when neither has room or the zip fails, the change goes on without it, and the result and `backup_skipped` say why. That zip is a Save the person owns: Upriv never removes it, and the result says it can be deleted. Then unnamed blobs are set aside and released blobs deleted, as at an open. A header that holds more than 6 keys first converts the files of the key with the least content, never the write key, onto the write key until it holds 6. Then the new KEK (same cost, new salt) and the new key, whose id is the generation of the next write. The header twins get `change`: the current keys, then the new key, `since` = the new key's id, under the new KEK, with the top block byte for byte as it was. The index is sealed under the top block's pair with the first batch's new blob ids in `released`. A stop or a failure before `change` is written leaves the password and every file as they were.
2. **Convert**, batch by batch (files adding up to 64 MiB at most and to what the free space holds beyond the reserve, always at least one file). Each file whose chunks are not all on the new key is read chunk by chunk, each chunk with its own key, into a new blob: new file id, key copy from `change`, record under the new key; a chunk that fails its check is carried byte for byte with key id 0, and a missing file stays marked. The blobs, their shard folders, then `data/` are flushed; the index is sealed with the new write key and `change`'s AAD, naming the new blobs and listing in `released` the old blobs it drops and the next batch's new ids; the old blobs are deleted once that seal is flushed. Blobs in `held/` that have a file are converted in `held/`. A stop is checked between chunks.
3. **Finish** (refuses a stop): a new header with `change`'s `kdf`, **the new key and no other**, `since` = the new key, a new generation, no `change`; the index sealed with `key_copies_due` on and key id 0 on every chunk of a file whose blob is missing; four atomic writes commit it (index copy, header primary, header copy, index primary), and `password_changed_at`, `content_hash`, and the backup stamp are updated. Then the pass runs in the same job, which starts over so Stop works again; a stop there is not a cancel: the change is made and the job after the next open finishes the key copies.
4. **Stop** (Stop, the quit's Close now, or a failed write) after `change` was written: the unsealed batch's new blobs are deleted; a new header with the old `kdf` and salt, the old keys, then the attempt's key when a file was converted, then **a fresh key made now, which becomes the write key**, `since` unchanged, a new generation, under the old KEK, no `change`; the index sealed under that block's pair with `key_copies_due` on; the four writes. The old password opens the vault. Every key of `change` was on disk under the new password, so none of them takes a new write again: the fresh key, never under the new password, does. The job after the next open runs the pass; nothing runs behind the stop.
5. **Pending at the next unlock** (a crash; decided before the unlock table, at an open and at a rebuild; every other caller refuses it with `password_change_interrupted`). The new password opens `change`: the vault settles forward to `change`'s keys and `since` (four writes, `key_copies_due` on). The old password opens only the top block: when the index opens under the top block's pair, no chunk of it is on a key only `change` holds, and the unlock marks no file missing for the first time, nothing was converted and the change is cancelled the way a stop is; otherwise `password_change_interrupted`, and the window asks for the new password.
6. **Unfinished**: a header that settled forward still holds a key below `since`. The vault works normally; the row says so and Password settings offers **Finish** (`vault_password_change_finish`): unlock, convert every file with a chunk on a key below `since`, key id 0 on the chunks of missing files, write the header with the keys still in use, run the pass. The state ends by itself when no chunk is on a key below `since`.

A header holds at most 8 keys; a finished change leaves one, and a stopped attempt adds up to two (its own key and the fresh write key), so a change starts with at most 6. Only the unlock that opens a session removes header keys no chunk and no held blob with a file uses (a header write with a new generation and `key_copies_due` on); the write key always stays.

### Unlock-RAM change

The keys stay: with the password unchanged, a new key would protect nothing (`vault_change_kdf`, keys lane). The same cost is refused from the header before any unlock; a pending password change refuses it, an unfinished one allows it. Unlock, set unnamed blobs aside, then a new header with a new salt and cost, the same keys and `since`, a new generation, and the index sealed under that block's pair with `key_copies_due` on; the four writes commit it and refuse a stop. The pass runs in the same job, which starts over so Stop works again; a stop or a crash there leaves the change made and some blobs at the earlier cost, which the job after the next open finishes. It writes no backup: no state of it can lock anyone out, and a copy at the earlier cost would only keep the cheaper guess beside the vault. Raising the cost protects once every key copy is updated. Older backups keep the unlock RAM they were written with; Upriv never changes them.

### Who can open what

P-old and P-new are the two passwords of one change; "the vault" is its `store/` and `held/`. Backups are outside it.

| State | P-old | P-new |
|---|---|---|
| Not started | everything | nothing |
| Stopped | everything | nothing saved after the stop; until the pass after the next open ends, every file from before the stop, through a converted blob's key copy |
| Pending (a crash) | every file while no batch is converted, and it cancels; after that the app asks for P-new, and only files not converted yet open with P-old, outside the app, through their key copies | everything; settles forward |
| Unfinished | nothing once the pass ends; until then, the files not converted yet, outside the app | everything |
| Finished | nothing once the pass ends; until then, a blob set aside with no file through its key copy | everything in the vault; until the pass ends, also backups from before the change |

At every point the two passwords together open every file. P-old alone falls short in one case: a crash after the first batch, then losing P-new; the backup written at the start holds those files under P-old when there was room for it.

**Rules:**
1. A new key is on disk only under the new password, until the person stops; a stop puts the attempt's key under P-old, and no key of `change` takes a new write again.
2. New data uses the write key, and the write key was never on disk under another password than the vault's.
3. The index opens only under the pair of the vault's header, and it names each chunk's key and version, so an older key cannot make a tree the vault accepts or put an old-key chunk in place of a converted one.
4. After a finished change and its pass, no earlier key is in the vault, not in the header and not in any blob; earlier keys exist only in the person's backups. A key is never on disk in the clear.
5. No key copy stays behind the header once its pass ends.
6. A header or index file is repaired only from a header and an index that opened together; a header older than the blobs repairs nothing and seals nothing.
7. **A key copy is a header block's own bytes.** Any blob plus the password opens that file, and a blob protects exactly as much as the header: the password and the unlock cost carry all of it. One blob alone is a complete target for offline guessing, so rule 5 matters for every blob.
8. **What someone without the password learns from one blob:** its file's exact size and roughly how many sessions wrote it, the vault's content identity, and the vault's unlock cost and salt.
9. Files not converted yet (pending, unfinished) can be read by someone with an older copy and P-old; a change to them shows as damage, since the index holds each chunk's version.
10. While a change is pending, someone with P-old and write access can put back an index sealed with the old key; the unlock then finds files whose blobs are gone, so it cancels nothing and deletes nothing, and P-new settles forward with the converted blobs set aside.
11. The job holds two KEKs in RAM while it runs, zeroized at its end; the passwords are dropped after each derive.

A backup or export made before the change opens with the password of its time and shows the vault as it was. A rename or a move writes no recovery record, so a record keeps the path its file had when it was written.

### Delete vault

Delete vault is a job (`vault_delete`, delete lane, no time limit), opened from the row's Settings menu in a window of its own. It records the delete in `config.toml` (`[deleting]`, with the outside-backups choice) and flushes it; from then the row is `deleting` and nothing opens the vault (`vault_deleting`). For each blob in `data/` and `held/` it overwrites the key copy with the vault's wipe setting, flushes, and removes the blob, so what is left on disk is what is left to do. Then it wipes the header and index files and removes the rest of `store/`, `held/`, and `backups/`, then the backups outside the data folder when the switch was on, then `persistence.json`, then `config.toml`, then the empty folder; at every point a crash can stop it, the row is there, `deleting`, with **Continue**. Create treats an empty vault folder as free, unless another create is setting it up. **Delete now** (`vault_delete_hurry`, in More options while a delete runs or waits, or a `vault_delete` with `now` on one the app did not finish) removes the blobs not reached with no overwrite: until the disk reuses the space, someone who has or guesses the password could read them, and its confirmation says so. A quit stops a running delete where it is; nothing continues on its own at launch.

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
| Both index files dead | Open fails `vault_index_unreadable`; rebuild restores the tree from records, writes a copy first when it can, refuses a readable index |
| Header lost or older than the blobs | Open fails `vault_header_unreadable`; rebuild reads the header back from the key copies, at the cost the person chose last |
| A lone blob | Opens with the password and its own bytes; its key copy is 4096 bytes and its first chunk starts at 4096 |
| A crash at every write of a password change, stop, finish, cancel, or settle | Each password, on a fresh copy, opens and every file reads, or is refused having written nothing; at least one of the two opens |
| After a finished change and its pass | An older backup's header and P-old open nothing in the vault; no blob's key copy holds an earlier key; the header holds one key |
| After a stop or a cancel | The write key is a key that was never in `change`; a copy of the store taken during the change opens no file saved afterwards with P-new |
| Delete vault | No key copy is readable afterwards; a delete cut short after each step shows `deleting` with Continue, and Continue ends with nothing left |

Fuzz truncated/garbage store dirs. A security pass should hunt protocol bugs, not only happy-path I/O.

---

## Landmines (do not paper over in the UI)

Applied review 2026-09-12. Confidentiality of closed `store/` passed for wrap + index + chunks as implemented. These items are protocol/product work, not “fix XChaCha.”

| Id | Issue | Do |
|----|--------|----|
| **P0** | Chunk AAD must not bind header `salt`/`m`/`t`/`p` or `file_size`. This format (`format_version` 1) already omits them. Wrap and index still bind the KDF params of their block. | Do not add those fields back. Do not add a reader for another `format_version`. A password change makes a new key and rewrites every file; an unlock-RAM change keeps the keys and reseals the header and the name index, and its pass updates every key copy. Neither leaves an earlier key in the vault once its pass ends. |
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

**Yes — while the vault is open, keys live in RAM.** That is required for decrypt/encrypt; it is not an Argon2→XChaCha protocol hole. Correct lifecycle: wipe the Argon2 working buffer after derive; hold the keyring and its layer keys only for the session; wipe on close. Residual leaks (malware, debugger, swap, hibernation, crash dumps, cold boot) are **open-session OS** threats — out of scope for “closed `store/` + Argon2.” Closed disk → attack is password guessing on the header KDF, not skipping to brute-force the 256-bit XChaCha key.

---

## Agent rules

1. Do not invent a second cipher/KDF “for fun.” Store = Argon2id + HKDF + XChaCha20-Poly1305 + AES-SIV names as specified.
2. Do not implement primitives; call a reviewed crate/API. Vault crypto crates are **vendored** at [`dev/vendor/`](../dev/vendor/) (`[patch.crates-io]` in `dev/Cargo.toml`). Do not `cargo update` Argon2 / AEAD / AES-SIV / `rand` without copying a new snapshot (checklist in `dev/vendor/MANIFEST.txt`) and reviewing `src/` against crates.io. Do not `cargo generate-lockfile` for that. Do not edit `vendor/*/src` except in that reviewed upgrade. `dev/.cargo/config.toml` sets `aes_armv8` on aarch64, the vendored `aes` cfg for ARMv8 AES instructions picked at run time; it changes speed, not bytes (`aes_siv_seals_the_same_bytes_on_every_aes_backend`). ChaCha20 stays on its software backend on ARM: `chacha20` 0.9 marks NEON nightly-only.
3. Do not treat `.7z` as the vault’s security story or as the backup format. On disk a backup is `<stamp>-<id>.zip` in the vault's backup folder (pin: `saves/<stamp>-<id>.zip` there, `<stamp>-<id> <name>.zip` once named): a **Stored** zip of `store/`, no zip password, no unpacked tree, no `.7z`. Backup export copies that file into a chosen folder, or bundles several of them into one Stored zip; while it reads a backup, delete, pin, and retention leave that backup alone. The portable export of the live vault is a separate `.zip` of `store/` (Recommended) or `.7z` (guessing warning). Restore = new vault from a backup zip, a store zip, or a `.7z`.
4. Argon2id cost is chosen **at create** (default **256 MiB / 3 passes**). Shipping presets include **32 MiB** (less-secure opt-in) and **128 MiB** (mid). Presets are security + unlock RAM, not device type. Never auto-select or downgrade the header from the current OS.
5. Do not ship store I/O without the tamper/truncation tests above.
6. For rest layout, backups, and storage modes (`encrypted_dir` + `upriv_plain` only), **this file wins** over PRD/SDD.
7. Plaintext vault bytes on ordinary disk **only** if the user chose `upriv_plain` and the vault is open. The one trace past that is the unallocated space Close now leaves, which the person chose behind its warning. Transitional phases (import, export, backup, password, recovery) must stream or copy ciphertext — never a convenience extract.
8. Surface anti-brute-force lives in **`upriv-core` RAM**: serialize `open`; **5** failures in **60 s** → **60 s** block. Not the UI, not a JSON counter. Do not market it as stopping offline guessing.
9. Password unlocks the header's keyring **once** per open. Saves = the write key's content key + new CSPRNG 192-bit nonce, not Argon2; the chunk version comes from that nonce. Never RAM counters or password-derived nonces. Close flushes with those session keys and does not ask for the password. Open-session OS leaks ≠ “XChaCha failed while editing.”
10. One store format. Do not add a reader for another `format_version`. Do not put KDF salt/`m`/`t`/`p` or `file_size` into chunk AAD. Every password change makes a new key and rewrites every file; no flow keeps an earlier key in the vault, and every flow that writes a blob keeps its key copy through the shared save helper (`StagedBlobs`). Do not reorder AAD struct fields. Do not claim VeraCrypt equivalence or “prevents brute force.”
11. Header `m`/`t`/`p` out of shipping bounds → fail closed. Do not lower `m` to make open snappy (that is the attacker’s optimization).
