# UI translations (i18n)

UI copy for desktop and mobile. Key naming rules live in `dev/docs/LOCALE.md`.

| File | Locale | Role |
|------|--------|------|
| `en.json` | `en` | Default and fallback |
| `pt-BR.json` | `pt-BR` | Portuguese (Brazil) |
| `es.json` | `es` | Spanish |

Add new locales by copying `en.json` to `<tag>.json`, translating values (keys stay the same), and registering the tag in `src/domain/app-settings/locales.ts`.
