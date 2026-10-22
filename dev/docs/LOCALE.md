# Language and localization policy

**Applies to:** Upriv repository, product bundles, implementation, and documentation.

## Rule: English everywhere

All **non-UI** project text must be in **English**:

| In scope | Examples |
|----------|----------|
| Documentation | `README.md`, `prd.md`, `sdd.md`, `LOCALE.md`, package READMEs |
| Config & data | TOML keys/comments, JSON field names, log messages, error codes |
| Code | Identifiers, comments, commit messages, CLI help |
| API / FFI | Command names, event names, structured errors |

**Not allowed** in the above: Portuguese (or any other language) prose, labels, or comments — except where noted below.

## Exception: UI strings via i18n only

**User-visible UI text** must never be hardcoded in source or config as full sentences in a specific language.

Use **stable keys** and locale files:

```
dev/apps/shared/locales/
├── en.json      # English (default / fallback)
├── pt-BR.json   # Portuguese (Brazil)
├── es.json      # Spanish
└── README.md
```

Electron main does not load these files. Its one dialog, the quit prompt while a vault is open, carries the text of `warning.vault_open_on_exit*` in `apps/electron/src/quitCopy.ts`, and `quitCopy.test.ts` fails when that text differs from any locale file.

### Key naming

- Dot-separated, lowercase: `vault.status.open`, `action.lock`, `modal.backup.title`
- Keys are **English slugs** (not Portuguese words)
- Values are translated per locale file

### Runtime locale

User preference in `.upriv/settings.toml`:

```toml
[ui]
locale = "en"   # "en" | "pt-BR" | "es"
```

- Default locale: **`en`**; a locale outside `SUPPORTED_LOCALES` loads `en`
- Every locale file carries every key of `en.json` (`locales-parity.test.ts`). A key missing from the catalog renders as the key itself
- Adding a locale = new `dev/apps/shared/locales/<tag>.json` + register in `SUPPORTED_LOCALES`, `@upriv/shared` `loadLocale` (desktop), mobile `loadMobileLocale`, and Electron `QUIT_COPY`

### What maps to i18n keys

| Use key | Do not use key for |
|---------|-------------------|
| Button labels, titles, toasts, dialogs | Vault IDs (`vault-example-1`, …) — user-defined |
| State badges (`open`, `closed`, `recovery`) | Technical persistence values in JSON/manifest |
| Warnings, confirmations, empty states | File paths, crypto algorithm names |
| Settings labels in the app UI | `7zz` / CLI output (English logs OK) |

**Persistence / protocol** stay English identifiers: `open`, `closed`, `recovery`, `encrypted_dir`, `upriv_plain` — UI translates them for display via `vault.status.*` keys.

### PRD / SDD convention

- Documents are written in **English**
- Where UX copy matters, reference **i18n keys** (e.g. “shows `vault.status.closed`”) instead of embedding Portuguese UI text

## In the code

- Desktop loads `dev/apps/shared/locales/{locale}.json` through `@upriv/shared` `loadLocale`; mobile through `loadMobileLocale`
- No hardcoded UI sentences in Rust/TS, outside the Electron quit prompt above
- Errors cross the wire as `snake_case` codes (`UprivError::WrongPassword` → `wrong_password`); the UI maps each code to a key (`error.wrong_password`)

## Related files

- `dev/apps/shared/locales/en.json` — English UI catalog (reference)
- `dev/apps/shared/locales/pt-BR.json` — Portuguese UI catalog
- `dev/apps/shared/locales/es.json` — Spanish UI catalog
- `dev/docs/prd.md`, `dev/docs/sdd.md` — English product/engineering docs
