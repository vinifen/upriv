import { useMemo } from "react";
import { VaultSettingsSection } from "@/components/settings";
import { InfoFieldList } from "@/features/system/info/InfoFieldList";
import { Button, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import {
  useBackupService,
  useVaultLifecycleService,
  useVaultRootService,
  useVaultService,
} from "@/platform/services";
import { useTranslation } from "@/i18n";
import { buildVaultInfoSections, type VaultGroup, type VaultListItem } from "@upriv/shared";
import { useVaultInfoData, useVaultRootIntegrityClose } from "@upriv/shared/react";
import { getMockVaultRuntimeStats } from "@upriv/shared/testing";

interface VaultInfoModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  groups?: readonly VaultGroup[];
}

export function VaultInfoModal({ vault, open, onClose, groups = [] }: VaultInfoModalProps) {
  const { t } = useTranslation();
  const { settings, reportVaultRootIntegrityFailure } = useAppSettingsContext();
  const vaultService = useVaultService();
  const backupService = useBackupService();
  const lifecycleService = useVaultLifecycleService();
  const vaultRootService = useVaultRootService();
  const { snapshot, loadError, loadFailure, retryLoad } = useVaultInfoData({
    vault,
    open,
    groups,
    locale: settings.ui.locale,
    vaultService,
    backupService,
    lifecycleService,
    vaultRootService,
    vaultRootMode: settings.app.vault_root_mode,
    workspaceGlobalPath: settings.workspace.path,
    fallbackVaultRootBase: "",
    getRuntimeStats: getMockVaultRuntimeStats,
  });

  useVaultRootIntegrityClose(open, loadFailure, reportVaultRootIntegrityFailure, onClose);

  const sections = useMemo(() => {
    if (!snapshot) return [];
    return buildVaultInfoSections(snapshot, t);
  }, [snapshot, t]);

  if (!open || !vault) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modal.vault_info.title")}
      titleIcon="info"
      contextTitle={vault.displayName}
      panelClassName="max-w-3xl"
    >
      {snapshot ? (
        <div className="space-y-2">
          {loadError ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-on-surface-variant">{t("modal.info.load_error")}</p>
              <Button variant="ghost" size="sm" onClick={retryLoad}>
                {t("modal.info.action.retry")}
              </Button>
            </div>
          ) : null}
          {sections.map((section) => (
            <VaultSettingsSection key={section.id} title={section.title} defaultOpen>
              <InfoFieldList fields={section.fields} />
            </VaultSettingsSection>
          ))}
        </div>
      ) : loadError ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-on-surface-variant">{t("modal.info.load_error")}</p>
          <Button variant="ghost" size="sm" onClick={retryLoad}>
            {t("modal.info.action.retry")}
          </Button>
        </div>
      ) : (
        <p className="font-mono text-sm text-on-surface-variant">{t("modal.info.loading")}</p>
      )}
    </Modal>
  );
}
