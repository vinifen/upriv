# Info modals — keep in sync

**Info** = read-only diagnostics (⋮ / ⋯ → **Info**). Not Help.

When you change data Info shows or should show — **update Info in the same task**:
- Shared builders: `@upriv/shared` `domain/system-info/`, `domain/vault-info/`
- i18n: `modal.info.*` in `locales/{en,pt-BR,es}.json`
- **Desktop and mobile** — both `dev/apps/desktop/` and `dev/apps/mobile/` (`features/system/info/`, `features/vaults/info/`)

Typical triggers: `AppSettingsConfig`, vault-root, `VaultListItem`, `VaultSettingsConfig`, inventory counts, runtime/mock stats.

Each value loads on its own: what the list and the settings know shows at once, and each read from core fills its rows as it lands (`useSystemInfoData`, `useVaultInfoData`). A row still waiting is `loadingField` (`loading: true`), drawn as a skeleton bar; never hold a section, or the window, for its slowest value. Every section starts open.
