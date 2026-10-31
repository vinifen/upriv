import type { VaultExportFormat } from "@upriv/shared";
import { useExportFolder, type ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";

/** The folder each export format writes into, one per format. */
export type VaultExportFolders = Record<VaultExportFormat, ExportFolder>;

/**
 * Kept by the vault list, so each format's folder stays for the next export
 * of any vault while the list is up, also after the Export window closes.
 */
export function useVaultExportFolders(): VaultExportFolders {
  const { t } = useTranslation();
  return {
    store_zip: useExportFolder(t("vault.export.dialog.picker_title.store_zip")),
    seven_zip: useExportFolder(t("vault.export.dialog.picker_title.seven_zip")),
    plain_zip: useExportFolder(t("vault.export.dialog.picker_title.plain_zip")),
  };
}
