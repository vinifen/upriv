/**
 * Client-layer error display (@upriv/shared).
 *
 * **Below the client** (upriv-core, daemon, Electron bridge): English `message` + machine `code`.
 * Use for logs, devtools, and support — not for UI copy.
 *
 * **User-facing surfaces:** resolve to an i18n key via `errorDisplayI18nKey()` or domain helpers — never raw `.message`.
 */
export { errorDisplayI18nKey } from "./display";
