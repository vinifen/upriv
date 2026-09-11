# @upriv/shared

**TypeScript only** — domain logic, formatters, and service interfaces shared by desktop (React) and mobile (React Native).

No React **runtime**, no platform APIs. Each app wires UI + `ServicesProvider` in its own `platform/services/`.

**Never add the `react` package here as a runtime or peer dependency** — npm installs those too. This package is installed via `file:../shared`, so its own `node_modules/react` becomes a second React instance under Metro and every hook throws `useState of null`. Ship UI behaviour as pure state machines instead (see `domain/vault-create/wizardState.ts`).

The one exception is `@upriv/shared/react`: hooks both apps import (`useCreateVaultWizard`, `useLoadingBudget`, `useToast`, `useVaultBackups`, `useVaultInfoData`, `useSystemInfoData`, `useVaultPipelineRun`). It is **not** on the main barrel. That subpath may depend on `@types/react` only — never the `react` runtime, and never `@testing-library/react` (its peers install `react` into `shared/node_modules`). Shared `tsconfig` stays without `lib: DOM`; timers and rAF go through `globalThis` (same idea as `delayMs`). Hook tests that need `renderHook` live in the desktop app, which already has one React copy.

Lint/format for this package uses `dev/js-lint` (install once: `npm install --prefix js-lint` from `dev/`). Rust fmt/clippy is separate (`npm run rust:lint`).

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
│   ├── icons/           # IconName catalog + ICON_GLYPHS (SVG primitives)
│   ├── info/            # Shared Info field/section types
│   ├── loading/         # Finite loading budgets
│   ├── logs/            # Log line parsing, sort, tone
│   ├── system-info/     # System Info snapshot builders
│   ├── theme/           # Palettes, radii, spacing, CSS custom properties
│   ├── timing/          # delayMs (globalThis timers)
│   ├── vault/           # Status tokens, displayName, vault wire errors
│   ├── vault-create/    # Wizard validate, draft helpers
│   ├── vault-groups/    # Group hierarchy, sort, picker
│   ├── vault-info/      # Vault Info snapshot builders
│   ├── vault-lifecycle/ # Pipeline kinds + client pipeline errors
│   ├── vault-list/      # Sort/view, export rules, password hint
│   ├── vault-root/      # Resolve/setup types + vault-root errors
│   ├── vault-settings/  # Per-vault VaultSettingsConfig (UI ↔ config.toml)
│   └── workspace/       # Mount path resolve + workspace errors
├── i18n/                # interpolate, loadLocale, key types
├── layout/              # Anchored menu placement (no DOM)
├── react/               # Optional hooks (`@upriv/shared/react`) — types only, no `react` package
├── services/            # AppServices interfaces (implementations in each app)
└── testing/             # Test-only helpers (`@upriv/shared/testing`) — mock export bytes, vault runtime stats, KDF/group/security mock factories

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

- React components, modals, RN shadow objects
- Tailwind class maps (`logLevelClass`, `vaultStatusRowClass`)
- Browser download (`downloadZip`), desktop RPC
- Mocks (`apps/desktop/src/platform/mocks/`)
