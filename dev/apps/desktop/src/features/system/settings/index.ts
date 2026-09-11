/** Public API — only exports consumed outside `system/settings/`.
 *
 * Future: split VaultRoot Gate/setup/repair/recovery into `system/vault-root/`;
 * keep app prefs here. Location picker lives in
 * `VaultRootLocationSection.tsx` (Data folder + Setup).
 */
export { AppSettingsModal } from "./AppSettingsModal";
export { AppSettingsProvider, useAppSettingsContext } from "./AppSettingsContext";
export { VaultRootGate } from "./VaultRootGate";
export { VaultRootDataFolderModal } from "./VaultRootDataFolderModal";
