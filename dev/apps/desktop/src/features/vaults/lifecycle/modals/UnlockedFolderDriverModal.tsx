import { Button, Modal } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";

/** The driver an encrypted vault's unlocked folder needs on this computer. */
export type UnlockedFolderDriver = "winfsp" | "fuse";

const MISSING_KEYS: Record<UnlockedFolderDriver, I18nKey> = {
  winfsp: "unlocked_folder.driver.winfsp_missing",
  fuse: "unlocked_folder.driver.fuse_missing",
};

const INSTALL_KEYS: Record<UnlockedFolderDriver, { idle: I18nKey; busy: I18nKey }> = {
  winfsp: {
    idle: "modal.app_settings.action.install_driver",
    busy: "modal.app_settings.action.install_driver_busy",
  },
  fuse: {
    idle: "modal.app_settings.action.install_fuse",
    busy: "modal.app_settings.action.install_fuse_busy",
  },
};

interface UnlockedFolderDriverModalProps {
  /** The vault that opened without its unlocked folder; `null` hides the window. */
  vaultName: string | null;
  driver: UnlockedFolderDriver;
  installing: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * After an encrypted vault opened, its unlocked folder needs FUSE or WinFsp
 * and that driver is missing: offer the installer, which asks the system
 * itself. Not now leaves the vault in the in-app file manager.
 */
export function UnlockedFolderDriverModal({
  vaultName,
  driver,
  installing,
  onInstall,
  onDismiss,
}: UnlockedFolderDriverModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={vaultName !== null}
      title={t("unlocked_folder.driver.title")}
      titleIcon="folder"
      contextTitle={vaultName ?? undefined}
      onClose={onDismiss}
      panelClassName="max-w-md"
      rootClassName="z-[140]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={installing} onClick={onDismiss}>
            {t("unlocked_folder.driver.not_now")}
          </Button>
          <Button variant="primary" size="sm" disabled={installing} onClick={onInstall}>
            {t(installing ? INSTALL_KEYS[driver].busy : INSTALL_KEYS[driver].idle)}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
        <p>{t(MISSING_KEYS[driver])}</p>
        <p>{t("unlocked_folder.driver.offer", { name: vaultName ?? "" })}</p>
      </div>
    </Modal>
  );
}
