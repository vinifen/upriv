/** Public API — only exports consumed outside `system/settings/`.
 *
 * Future: split VaultRoot Gate/setup/repair/recovery into `system/vault-root/`;
 * keep app prefs + bulk export here. `appSettingsForm.tsx` can split into section
 * components without changing this barrel.
 */
export { AppSettingsModal } from "./AppSettingsModal";
export { AppSettingsProvider, useAppSettingsContext } from "./AppSettingsContext";
export { VaultRootGate } from "./VaultRootGate";
export {
  downloadVaultsZip,
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultArchiveFilename,
  vaultArchiveZipEntryPath,
  vaultBlocksBulkExport,
} from "./vaultBulkExport";
