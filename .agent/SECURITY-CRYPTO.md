# Store crypto — Argon2id + XChaCha20-Poly1305

**Audience:** anyone implementing vault store, backups, key wrap, or `.7z` export in `upriv-core`.  
**Status:** implementation invariant **and** the bar for shipping `contents/`. `dev/` has header wrap + AES-SIV index + XChaCha chunks (create writes a seed file). **Change-password / salt rotation is not shipped** until landmine P0 (chunk AAD still binds `salt`/`m`/`t`/`p`).  
**Related:** PRD **RF-55**; SDD **§2.4.1**, **§6**; [SECURITY-PLAINTEXT.md](SECURITY-PLAINTEXT.md).  
**Product split:** at rest the vault body is **`contents/`** (Argon2id + AEAD). **Backups** are copies of that body. Portable files: an ordinary **`.zip` of `contents/`** (**Recommended**; zip is an envelope, no zip password) or **`.7z`** (logical Plan B, weaker guessing). Neither lives in `.upriv` as rest. **No `archive/`.**

Sketch on disk: `temp/upriv/prod-example/.upriv/vaults/teste/` + that bundle’s `LAYOUT-STORE.md` (gitignored research tree; not canonical `prod-example/` yet). **Greenfield:** implement only this layout. No reader for old `archive/` + `store/` / Seal — those were unfinished demos, not a shipping format to migrate.

This note records a reviewed crypto stance: primitives are strong; **the protocol around them is the real risk**. Round-trip encrypt/decrypt proves almost nothing.

**Closed `contents/` (applied review, 2026-09-12):** no **known** second path to plaintext without the password. Residual attack = guess the password paying the header Argon2id. That is **not** a formal proof, **not** “impossible to break,” **not** “prevents brute force.” A weak password still loses. In-app throttle (5 fails / 60 s) is process-RAM friction only — `open_store` and any offline copy ignore it.

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
| **HKDF** | Split the random **master** into **independent** keys (content + index). Wrap uses the Argon2 **KEK**, not a third HKDF arm. Never use the raw Argon2 output as every layer’s key. |
| **XChaCha20-Poly1305** | Confidentiality + authenticity of **content chunks** (192-bit nonce → random nonces are practical). |
| **AES-SIV** (`name_cipher`) | Encrypted path index — logical names must not appear as plaintext filenames under `contents/data/` (SDD §2.4.1). |
| **Poly1305 / AEAD tag** | Detects alteration. Decryption must **not** return plaintext if the tag fails (libsodium-style: authenticate first). A flipped bit on disk → hard fail, not silent garbage. |
| **`.7z` (AES-256 + SHA-256)** | **Export only** — one portable file for 7-Zip / ZArchiver. Weaker against offline guessing than the store; do not leave it as a permanent twin of the store. |

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
    └── info "upriv-index-key-v1"    → index key (AES-SIV)
```

Wrap uses the Argon2 **KEK**, not a third HKDF output. HKDF `salt=None` is intentional: IKM is a 32-byte CSPRNG master. Do not add a public HKDF salt without a `format_version` bump.

**At rest:** `contents/` only (`vault.header` + `index/` + `data/`). Lock = close. No Seal, no `archive/`.  
**On-disk zones:** plaintext `config.toml` + `persistence.json` at `vaults/<id>/` (list/name/policy **without** the password). Ciphertext only under `contents/`.  
**Snapshots (backup):** a `backups/<stamp>/` (or `backups/saves/<stamp>/`) **is a frozen `contents/`** — same trio, copy ciphertext, do not decrypt-then-re-encrypt. **No `snapshot.toml`.** Kind = path (`backups/` vs `saves/`); time = folder stamp. Pins are not named via a sidecar (UI can show the stamp).  

### Import / export (two formats)

Create-vault-from-file and export both offer **two** payloads. Detect on import (`vault.header` inside a zip vs 7z magic). Files stay **outside** `.upriv`.

| Format | What it is | Security | Password to export | Opens in | UI |
|--------|------------|----------|--------------------|----------|-----|
| **`.zip` of `contents/`** | Ordinary zip envelope (**no zip password**) of `vault.header` + `index/` + `data/` (opaque ciphertext). Not a custom file type. | Same as the vault (Argon2id + AEAD) | **Closed:** none (copy ciphertext). **Open:** copy live `contents/` after flush, or same tree. | Any zip tool lists ciphertext; Upriv decrypts | **Recommended** |
| **Portable `.7z`** | Logical files, 7-Zip AES + SHA-256 KDF | Weaker **offline guessing** than the contents zip (honest copy — not “Upriv beats 7-Zip”) | Yes (must decrypt). Open vaults: session; closed: ask password. | 7-Zip / ZArchiver | Versatile; warn about guessing |

**Create from a contents `.zip`:** same as create-from-backup — new `vaults/<id>/`, copy extracted `contents/` (no re-encrypt, no plaintext tree). Unlock = snapshot password.

**Create from `.7z`:** stream logical content into **new** `contents/` (Argon2id wrap). Do not keep that `.7z` in the vault. Never pack `.enc` blobs into `.7z`. Decrypt only in RAM / the 7zz pipe (SECURITY-PLAINTEXT).

Export UI: user **chooses**; default / badge = `.zip` of encrypted contents.

**Suggested filename** = vault **display name** (list name), not the registry folder id:

| Format | Default save name |
|--------|-------------------|
| `.zip` of `contents/` | `{display_name}.zip` |
| Portable `.7z` | `{display_name}.7z` |

The save dialog may let the user rename the file. If the OS rejects characters, block or **minimal-sanitize the filename only** — do **not** change the vault’s `display_name`. Import: stem of `.zip` / `.7z` → proposed display name (same sanitize dialog if invalid).

### Create vault from backup (RF-56)

Same as **create from a contents `.zip`**: **new vault**, source unchanged. A stamp folder **is** that tree without the zip envelope.

1. New `vaults/<new-id>/` with new `config.toml` / `persistence.json` (new display name, e.g. `teste (backup)`).
2. Copy the snapshot tree → `contents/` (no 7z, no extract to disk).
3. Unlock uses the **password from when that snapshot was taken** (RF-59: old snapshots keep the old password if the live vault later changes password).

**No in-place restore.** Do not overwrite the live `contents/` with a snapshot.

**Identity / AAD:** registry id (`config.toml` / folder name) **may be new**. Do **not** rewrite `vault.header` or chunks on copy (that would break AEAD). Bind AAD to a **content identity** stored in the header and copied with the snapshot — not to the registry slug. Prototype `vault.header.vault_id` is a sketch; shipping protocol must not require rewriting ciphertext to fork a backup into a new list row.

### Storage modes (collapse)

The old seven modes mixed **where the vault rests** (store vs `.7z` vs both) with **what lock does** (close vs Seal). Rest is always `contents/`; Seal and `archive/` are gone; `.7z` is an **action** (import/export), not a resting twin. Only **how the vault is open** remains.

| Keep | Id | While open | At rest |
|------|-----|------------|---------|
| **Default** | `encrypted_dir` | Decrypt in RAM only. **Desktop:** FUSE (Linux) / WinFsp (Windows) folder. **Mobile:** in-app file manager (same session — no OS mount). | `contents/` |
| **Large / insecure** | `upriv_plain` | Real plaintext `workspace/` (UI warning) | `contents/`; wipe workspace on close |

| Drop | Why |
|------|-----|
| `store_only` | “No `.7z` until Seal” — no Seal, no twin; same as default |
| `upriv_only` | “Store only, More secure” — that **is** default rest now |
| `ram_only` | Survived only by Sealing into `.7z`; nowhere to persist |
| `plain` | Open = plaintext **+** `.7z` twin; without the twin = `upriv_plain` |
| `plain_only` | Open = plaintext; rest was Seal → `.7z`; rest is now `contents/` = `upriv_plain` |

**States:** `open` is a **runtime session** (unlocked), not a disk enum. Where plaintext lives while open depends on mode — not on “open” itself:

| Mode | While open (plaintext) | At rest |
|------|------------------------|---------|
| `encrypted_dir` (default) | RAM only: FUSE/WinFsp reply buffers (desktop) or in-app file-manager buffers (mobile) | `contents/` |
| `upriv_plain` | Real files on disk under `workspace/` | `contents/`; wipe workspace on close |

**Mobile is the same vault.** `contents/`, header, chunks, import/export, backups, KDF — one `upriv-core` via FFI. There is **no FUSE** on Android/iOS; “open” still means an unlocked session, not a system folder. Do **not** copy the vault into `filesDir` / iOS tmp to fake a mount (plaintext spill). Android vault-root bytes go through SAF (`content://`); chunk I/O must stream, not extract a tree. Opening a file in an **external** app is not a FUSE path — stream (e.g. Android content URI) or refuse; a cache dump is `upriv_plain` behavior.

On disk, persistence is only **`closed`**. **No `sealed`.** No Seal action, no `canSeal`, no close/seal dropdown.

### On-disk schema (no Seal)

Drop from config / persistence / list DTO / UI: `sealed`, `canSeal`, `action.seal`, `[close] default_action`, `archive_hash`, `storageModeCanSeal` / `storageModeSealOnly`. Lock is always **close** → `contents/` stays, `persistence = "closed"`.

Keep: `content_hash`, `last_close_ok_at` (recovery A). `open` is session, not a persisted enum.

**`content_hash`** = SHA-256 of `vault.header` bytes **concatenated with** the sealed index blob. Chunk files are **not** in the hash. It is a dirty-close / recovery signal, **not** a MAC of the whole tree. Bitrot of one `*.chunk.enc` is a per-file tag fail (recovery B), not a `content_hash` mismatch.

PRD/SDD still mention Seal — **this file wins.**

### Recovery (no archive twin)

| Case | What happened | UI |
|------|----------------|-----|
| **A — Dirty close** | Crash/kill mid-write: torn chunk, index/data mismatch, `last_close_ok` false / `content_hash` mismatch | Vault **recovery**: last close did not finish. Offer **open what is intact** or **create a new vault from the latest `backups/` copy**. Never in-place overwrite live `contents/` with a snapshot. |
| **B — Chunk tag fail** | Bitrot / one blob | Vault **opens**. Toast/error on **that file**. Not vault-level recovery. Restore that file only via backup/package. |
| **C — Header or index dead** | Cannot unlock or cannot map the tree | Cannot repair in place. Only **create vault from backup / contents `.zip`**. |
| **D — `upriv_plain` crash** | Leftover plaintext `workspace/`; `contents/` may be stale | Vault **recovery**: leftover clear files from the last session. Offer **resume as open** (workspace is the live tree) or **wipe workspace** and keep `contents/` (unsynced edits may be lost). |

Do not invent a second body or a 7z repair picker.

**Not modes:** import/export (`.zip` of `contents/` **Recommended**, or `.7z`), in-app backup (`contents/` clone), create-from-backup. Available in both remaining modes.

### Export is per vault

No System settings bulk zip of many vaults. Copy **one vault at a time** from that vault’s row (`.zip` of `contents/` or `.7z`). To move several vaults, export each (or copy `contents/` / a `backups/<stamp>/` folder).

**Open vaults may export, with all current edits.** Flush the session into `contents/` first (same write-through as close, but the vault **stays open**), then copy/stream. Closing and recovery cannot export.

| Format | Closed | Open (after flush) |
|--------|--------|--------------------|
| `.zip` of `contents/` | Copy `contents/` — **no password** | Copy flushed `contents/` — **no password** |
| `.7z` | Ask password; decrypt from `contents/` | Stream from the live session (already unlocked) |

Do not reintroduce Seal, a durable `.7z` beside `contents/`, a zip-of-many-vaults settings section, or the dropped ids in new UI/core. PRD/SDD may still mention seven modes — **this file wins** until that docs PR.

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

256 MiB does **not** “prevent brute force.” A short password is still cheap in wall-clock if the attacker accepts 256 MiB per try. It **does** make GPU/ASIC guessing much more expensive than 7-Zip’s KDF and than a few-MiB Argon2. Password entropy still dominates.

- **Forbidden:** dropping to a few MiB because the UI feels snappy; auto-selecting a preset from “we are on mobile”; auto-downgrading the header on open.
- Do not reuse one derived key for wrapping + content + names without HKDF (or equivalent) domain separation.

Sketch in `prod-example` (`memory_kib = 131072`) is a **placeholder**, not the shipping default (`262144` KiB = 256 MiB).

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

Every AEAD must bind protocol context. **v1 wrap and index** bind at least: format version, **content identity** (not the registry folder id), algorithm identifiers, KDF `m`/`t`/`p`/salt, `kind`. **v1 chunks** also bind `file_id`, `chunk_index`, `file_size`, `chunk_len` — and still bind salt/`m`/`t`/`p` (see landmine P0).

Unauthenticated header fields that change how the rest is interpreted are a protocol bug.

**Serialization (frozen for `format_version` 1):** AAD is `serde_json::to_vec` of a **dedicated struct**. Byte order = **struct field order**, compact JSON, no extra spaces. It is **not** the pretty-printed `vault.header` on disk and **not** RFC 8785 / sorted-key JSON. Reordering fields, renaming keys, or switching to a sorted map **bricks existing vaults**. Golden vectors live in `contents/header.rs` (`aad_bytes_are_struct_field_order`). Do not “fix” this to canonical JSON without a version bump and a migrator.

### Format / ops

- Version the store format; never silently accept unknown versions.
- Fail closed on wrong password, corrupt header, missing chunks, tag mismatch.
- Crypto, KDF, and wipe live **only** in `upriv-core` — not TypeScript, not Electron main, not the Expo module beyond FFI.
- Password never on `7zz` argv, never in logs, never in `localStorage`.
- Header wrap of keys is itself AEAD, not “XOR and hope.”

### Shipping on-disk protocol (v1)

These were implementation defaults; they are now **the format** until a version bump.

| Piece | Value |
|-------|--------|
| Header file | `contents/vault.header` — **JSON** (UTF-8), versioned (`format_version`) |
| Content identity | UUID in the header; copied with backups/packages; **not** the registry folder id |
| Chunk size | **256 KiB** logical plaintext per chunk (last chunk may be shorter; empty file = no data chunks) |
| Chunk files | `contents/data/<file_id>.<chunk_index>.chunk.enc` — `nonce \|\| ciphertext \|\| tag` |
| Index | `contents/index/` — AES-SIV sealed tree (`root.idx.enc`); logical names never appear as plaintext paths under `data/` |
| Wrap | Argon2id (`m`/`t`/`p` + 16-byte salt from header, version **0x13** hardcoded) → 32-byte KEK → XChaCha unwrap of 32-byte master. Blob = nonce(24) ‖ ct ‖ tag(16) |
| HKDF | SHA-256, `salt=None` (IKM is CSPRNG master), info `upriv-content-key-v1` (32 B) / `upriv-index-key-v1` (64 B) |
| AAD JSON | Compact `serde_json` of a dedicated struct in **field order**. Not pretty `vault.header`, not RFC 8785. Frozen for v1 — golden vector in `header.rs` |
| KDF bounds on open | `m` **32 MiB..=2 GiB**, `t` **1..=16**, `p` **= 1**. Out of range → fail closed **before** Argon2 (malicious header DoS) |
| Argon2 version | **0x13** hardcoded; not in header/AAD. Changing it is a format bump |
| Unknown `format_version` | Fail closed |

**Open session (same `contents/`, different presentation):**

| Platform | How the user sees files |
|----------|-------------------------|
| Linux desktop | FUSE mount |
| Windows desktop | WinFsp |
| Android / iOS | In-app file manager; decrypt chunks into RAM; **no** OS FUSE. Android vault-root bytes via SAF — never copy the vault to `filesDir`. |

**v1 delivery** can still land Linux first, then Windows, then mobile FFI — the **format** is shared from day one.

---

## Glossary

**Plaintext** — the vault bytes the user means (file contents, names in the logical tree).  
**Ciphertext** — those bytes after AEAD: unreadable without the key. On disk that is `wrapped_master_key_b64`, `*.chunk.enc`, `root.idx.enc`. Seeing ciphertext is expected; it is not the secret.  
**Nonce** — a number used **once** with a given key (“number used once”). XChaCha mixes it with the key so each message gets a unique keystream. It is **not** a password and is stored next to the ciphertext (public). **Never** reuse `(key, nonce)`.  
**AAD** — extra bytes the tag covers but that are not the file body (chunk index, content identity, sizes, KDF fields). Without AAD, swapping blobs can still “decrypt”.

## Protocol / I/O bugs (password not required)

Closed `contents/` + a correct protocol → attack is password guessing (Argon2). These bugs let an attacker **skip** that, or skip our product promise. Round-trip encrypt/decrypt does **not** catch them.

| Bug | What goes wrong |
|-----|-----------------|
| **`(key, nonce)` reuse** | Two messages, same key + same nonce → XOR of ciphertexts leaks XOR of plaintexts; Poly1305 can be forged. Use a CSPRNG 192-bit nonce **per** wrap/chunk. Zero/password-derived/tiny-counter nonces are forbidden. |
| **No AAD** | Each chunk authenticates **alone**. Swap/reorder blobs or (unbound) header fields → decrypt succeeds in the **wrong** place. Bind version, content identity, algos, KDF params, file id, chunk index, sizes. |
| **Plaintext in `/tmp`** | `export_logical_tree` / extract-then-`7zz` writes the logical tree to OS temp. Crash, undelete, other users, swap. Stream only; cancel/crash must not leave an extract (SECURITY-PLAINTEXT). |
| **Password on argv** | `7zz -p…` appears in `ps`, `/proc/…/cmdline`, shell history, audit logs. Pass via stdin / a restricted fd, never argv, never logs. |

`temp/` close/export used tempfile trees and often `-p` on argv — **do not port**. Prototype `encrypt_chunk` has **no AAD** — do not ship that.

### Password, master key, edits, nonces

The password is **not** mixed into each file. It unlocks a random master key **once** per open. Saves use the derived **content key** plus a **new nonce**.

**Normalization (fixed before Argon2id lands):** the bytes passed to the KDF are **exactly as typed** — no `trim()`, no silent Unicode form unless we later adopt **NFC applied identically** on create and unlock, on every platform. `trim()` is allowed **only** to detect an empty field (`if (!password.trim())`). Mocks and UI must follow this rule so they are not copied into `upriv-core` later. A mismatch between create and unlock is permanent data loss (no password recovery).

```text
password → Argon2id (header salt + m/t/p) → KEK → unwrap MASTER KEY
         → HKDF → content key (XChaCha chunks) + index key (AES-SIV)
```

| When | Argon2? | Nonce? |
|------|---------|--------|
| **Open** | Yes (once) | **Read** nonce already stored on wrap + each chunk. Do not generate. |
| **Edit / flush chunk** | No | **Generate** 192-bit CSPRNG nonce, encrypt, store `nonce \|\| ciphertext\|\|tag`. Unchanged files keep old blobs. |
| **Close** | No | Only dirty objects get new messages (new nonces). Then wipe keys from RAM. |
| **Change password** | Yes (new KEK) | New wrap nonce; **same** master key so chunks usually **not** rewritten. **Blocked on v1:** chunk AAD still includes salt/`m`/`t`/`p`. Rotating salt without rewriting every chunk → tag fail on files. Do **not** ship rewrap until format_version ≥ 2 drops those fields from **chunk** AAD only (keep them on wrap + index). |

Editing does **not** weaken XChaCha or “re-run Argon2.” Primitive fatigue is not a thing. Bugs on this path are **ours**: nonce reuse, plaintext staging, missing AAD, torn `.enc` writes (atomic replace), encrypting with the password instead of the content key.

**Open vault (session):** OS/malware/swap/hibernation/external editors are out of scope for “closed disk + Argon2.” That is not an algorithm hole. `upriv_plain` **is** plaintext on disk while open (user chose it).

**Closed `contents/`:** if wrap + AAD + unique nonces + no spill hold, the attack is password guessing. You cannot skip Argon2 by rewriting it; a fake KDF yields the wrong KEK. You cannot brute-force XChaCha’s 256-bit key instead of the password.

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
| Backup snapshot | Copy into a **new** vault’s `contents/`; source unchanged; opens with snapshot password |
| Export cancel or crash | No leftover decrypted tree on disk (RF-49) |

Fuzz truncated/garbage store dirs. A security pass should hunt protocol bugs, not only happy-path I/O.

---

## Landmines (do not paper over in the UI)

Applied review 2026-09-12. Confidentiality of closed `contents/` passed for wrap + index + chunks as implemented. These items are protocol/product work, not “fix XChaCha.”

| Id | Issue | Do |
|----|--------|----|
| **P0** | v1 **chunk** AAD still binds header `salt`/`m`/`t`/`p`. Spec for change-password: new wrap, **same** master, **do not** rewrite chunks. Rotating salt (required — unique salt) without rewriting every `*.chunk.enc` → AEAD fail on files. | Do **not** ship change-password / KDF upgrade until `format_version` ≥ 2 drops salt/`m`/`t`/`p` from **chunk** AAD only (keep on wrap + index), plus migration + tests. |
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

**No.** Closed-disk residual attack in all three is password + KDF. Upriv primitives are more modern (memory-hard + AEAD vs classic VeraCrypt PBKDF2+XTS and 7-Zip SHA iterations). VeraCrypt has years of operational review; Upriv’s protocol is new and unaudited as a product. AEAD vs XTS is tamper/bitrot behavior, not product equivalence. AES-256 in 7-Zip is not “broken.” Recommended portable file = ordinary `.zip` of `contents/` (no zip password). `.7z` is Plan B (weaker guessing). Never pack `.enc` blobs into `.7z`.

### Does Argon2id “stop” brute force?

**No.** It makes each **offline** guess expensive (memory-hard). Weak passwords still lose. The in-app throttle (**5** fails / **60 s** → **60 s** block in `upriv-core` RAM) is only friction while Upriv is running — quit/reopen or attack `vault.header` offline bypasses it. Do not market either as “prevents brute force.”

### 7-Zip ~10⁴ guesses/s vs Argon2id 1 GiB “&lt;100/s”?

**Directionally yes; do not ship exact rates.** 7-Zip’s SHA-256-style KDF parallelizes well on GPU. Argon2id with `m` = 1 GiB needs ~1 GiB **per** try, so GPU swarms collapse; a normal PC is often **a few tries/s or less**, not “almost 100.” Fat servers can parallelize by available GiB. Measure if you quote numbers; password entropy still dominates.

### Can we free the 1 GiB immediately / skip holding it?

**During Argon2:** the implementation must **allocate and use** ~`m` bytes for the whole derivation. Early free or a fake low-RAM path is an optimization an attacker uses too — the hardness disappears. **After** Argon2 succeeds: wipe and free that buffer; the open session keeps only small keys, not 1 GiB for the whole time the vault is open.

### Is Argon2id internationally accepted as secure?

**Yes, as the current password-hashing / password-KDF default when available.** Winner of the 2015 Password Hashing Competition; IETF **[RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)** (recommends **Argon2id**; first option ~2 GiB / `t=1`, second ~64 MiB / `t=3`); **[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)** prefers Argon2id. Security still depends on parameters + password. Some **FIPS**-only environments still require PBKDF2.

### After Argon2 hands a key to XChaCha, can the key leak?

**Yes — while the vault is open, keys live in RAM.** That is required for decrypt/encrypt; it is not an Argon2→XChaCha protocol hole. Correct lifecycle: wipe the Argon2 working buffer after derive; hold master/content keys only for the session; wipe on close. Residual leaks (malware, debugger, swap, hibernation, crash dumps, cold boot) are **open-session OS** threats — out of scope for “closed `contents/` + Argon2.” Closed disk → attack is password guessing on the header KDF, not skipping to brute-force the 256-bit XChaCha key.

---

## Agent rules

1. Do not invent a second cipher/KDF “for fun.” Store = Argon2id + HKDF + XChaCha20-Poly1305 + AES-SIV names as specified.
2. Do not implement primitives; call a reviewed crate/API.
3. Do not treat `.7z` as the vault’s security story or as the backup format. Backup / **Recommended** portable file = copy of `contents/` (zip envelope OK). `.7z` = versatile export with a guessing warning. Restore = new vault from package or from `.7z`.
4. Argon2id cost is chosen **at create** (default **256 MiB / 3 passes**). Shipping presets include **32 MiB** (less-secure opt-in) and **128 MiB** (mid). Presets are security + unlock RAM, not device type. Never auto-select or downgrade the header from the current OS.
5. Do not ship store I/O without the tamper/truncation tests above.
6. When PRD/SDD still describe Seal, dual store+`.7z` rest, or seven storage modes, **this file wins** for rest layout, backups, and modes (`encrypted_dir` + `upriv_plain` only). Product docs catch up in a dedicated PRD/SDD edit.
7. Plaintext vault bytes on ordinary disk **only** if the user chose `upriv_plain` and the vault is open. Transitional phases (import, export, backup, password, recovery) must stream or copy ciphertext — never a convenience extract.
8. Surface anti-brute-force lives in **`upriv-core` RAM**: serialize `open`; **5** failures in **60 s** → **60 s** block. Not the UI, not a JSON counter. Do not market it as stopping offline guessing.
9. Password unlocks the master key **once** per open. Saves = content key + new CSPRNG 192-bit nonce, not Argon2. Never RAM counters or password-derived nonces. Close flushes with those session keys — do **not** rewrap `vault.header` from a typed lock password (`always_prompt` is a presence check only). Open-session OS leaks ≠ “XChaCha failed while editing.”
10. Do **not** ship change-password / KDF rewrap on format v1 until landmine P0 is fixed (chunk AAD vs salt rotation). Do not reorder AAD struct fields. Do not claim VeraCrypt equivalence or “prevents brute force.”
11. Header `m`/`t`/`p` out of shipping bounds → fail closed. Do not lower `m` to make open snappy (that is the attacker’s optimization).
