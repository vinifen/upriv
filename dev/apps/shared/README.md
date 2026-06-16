# @upriv/shared

**TypeScript only** — domain logic, formatters, and service interfaces shared by desktop (React) and mobile (React Native).

No React, no DOM, no platform APIs. Each app wires UI + `ServicesProvider` in its own `platform/services/`.

## Layout

```text
src/
├── domain/           # Types + pure functions
│   ├── app-settings/ # normalizeAppSettings, logging constants
│   ├── backups/      # backup filename parsing
│   ├── file-tree/    # tree ops, import paths, file name validation
│   ├── format/       # formatBytes, formatIsoDate
│   ├── help/         # help section catalog + search
│   ├── logs/         # log line parsing, sort
│   ├── vault/        # status tokens, displayName validation
│   ├── vault-create/ # wizard validate, draft helpers
│   ├── vault-list/   # export rules, password hint, last accessed
│   └── …
├── i18n/             # interpolate, loadLocale, key types
├── locales/          # en.json, pt-BR.json, es.json (UI catalog)
└── services/         # AppServices interfaces (implementations in each app)
```

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
- Browser download (`downloadZip`), Tauri invoke
- Mocks (`apps/desktop/src/platform/mocks/`)
