# Language and localization policy

**Applies to:** Upriv repository, product bundles, implementation, and documentation.

## Rule: English everywhere

All **non-UI** project text must be in **English**:

| In scope | Examples |
|----------|----------|
| Documentation | `README.md`, `PRD.md`, `SDD.md`, `LOCALE.md`, package READMEs |
| Config & data | TOML keys/comments, JSON field names, log messages, error codes |
| Code | Identifiers, comments, commit messages, CLI help |
| Demo bundle | `prod/` placeholders and README |
| API / FFI | Command names, event names, structured errors |

**Not allowed** in the above: Portuguese (or any other language) prose, labels, or comments — except where noted below.

## Exception: UI strings via i18n only

**User-visible UI text** must never be hardcoded in source or config as full sentences in a specific language.

Use **stable keys** and locale files:

```
dev/docs/i18n/
├── en.json      # English (default / fallback)
├── pt-BR.json   # Portuguese (Brazil)
└── README.md
```

### Key naming

- Dot-separated, lowercase: `vault.status.open`, `action.lock`, `modal.backup.title`
- Keys are **English slugs** (not Portuguese words)
- Values are translated per locale file

### Runtime locale

User preference (example in `main.toml`):

```toml
[ui]
locale = "en"   # "en" | "pt-BR" | future BCP-47 tags
```

- Default locale: **`en`**
- Fallback chain: requested locale → `en` → key string (dev only)
- Adding a locale = new `dev/docs/i18n/<tag>.json`; no code changes for copy-only updates

### What maps to i18n keys

| Use key | Do not use key for |
|---------|-------------------|
| Button labels, titles, toasts, dialogs | Vault IDs (`vault-example-1`, …) — user-defined |
| State badges (`open`, `closed`, `sealed`, `recovery`) | Technical persistence values in JSON/manifest |
| Warnings, confirmations, empty states | File paths, crypto algorithm names |
| Settings labels in the app UI | `7zz` / CLI output (English logs OK) |

**Persistence / protocol** stay English identifiers: `open`, `closed`, `sealed`, `encrypted_dir`, `plain` — UI translates them for display via `vault.status.*` keys.

### PRD / SDD convention

- Documents are written in **English**
- Where UX copy matters, reference **i18n keys** (e.g. “shows `vault.status.sealed`”) instead of embedding Portuguese UI text

## Implementation checklist

- [ ] Tauri/React (or equivalent) loads `dev/docs/i18n/{locale}.json`
- [ ] No `language = "pt-BR"` as hardcoded UI strings in Rust/TS
- [ ] Error types: `ErrorCode::WrongPassword` + i18n `error.wrong_password`
- [ ] CI: reject new Portuguese comments in `crates/` (optional lint later)

## Related files

- `dev/docs/i18n/en.json` — English UI catalog (reference)
- `dev/docs/i18n/pt-BR.json` — Portuguese UI catalog
- `dev/prd.md`, `dev/sdd.md` — English product/engineering docs
