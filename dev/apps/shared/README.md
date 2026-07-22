# @upriv/shared

**TypeScript only** — domain logic, formatters, and service interfaces shared by desktop (React) and mobile (React Native).

No React, no DOM, no platform APIs. Each app wires UI + `ServicesProvider` in its own `platform/services/`.

## Layout

```text
src/
├── domain/              # Types + pure functions
│   ├── app-settings/    # AppSettingsConfig, normalize, logging constants
│   ├── backups/         # Backup filename parsing
│   ├── core-rpc/        # CORE_RPC_COMMANDS, protocol errors
│   ├── errors/          # Cross-cutting UI error → i18n mapper
│   ├── file-tree/       # Tree ops, import paths, file name validation
│   ├── format/          # formatBytes, formatIsoDate
│   ├── help/            # Help section catalog + search
│   ├── logs/            # Log line parsing, sort
│   ├── vault/           # Status tokens, displayName, vault wire errors
│   ├── vault-create/    # Wizard validate, draft helpers
│   ├── vault-lifecycle/ # Pipeline kinds + client pipeline errors
│   ├── vault-list/      # Sort/view, export rules, password hint
│   ├── vault-root/      # Resolve/setup types + vault-root errors
│   └── vault-settings/  # Per-vault VaultSettingsConfig (UI ↔ config.toml)
├── i18n/                # interpolate, loadLocale, key types
└── services/            # AppServices interfaces (implementations in each app)

locales/                 # en.json, pt-BR.json, es.json (UI catalog)
```

**Naming vs Rust:** TS `VaultSettingsConfig` / `domain/vault-settings` maps to on-disk
`vaults/<id>/config.toml`, loaded in `upriv-core` as `config::vault_config` (`VaultConfig`).
App prefs stay in `domain/app-settings` ↔ `.upriv/settings.toml` (`config::app_settings`).

## Consumers

```json
"@upriv/shared": "file:../shared"
```

```bash
cd dev/apps/desktop && npm install
```

## Desktop-only (not here)

- React components, hooks, modals
- Tailwind class maps (`logLevelClass`, `vaultStatusRowClass`)
- Browser download (`downloadZip`), desktop RPC
- Mocks (`apps/desktop/src/platform/mocks/`)
