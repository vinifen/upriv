import { useCallback, useMemo } from "react";
import { VaultSettingsSection } from "@/components/settings";
import { Button, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { APP_VERSION, getAppVersion, getSessionAppVersion } from "@/lib";
import { useVaultRootService } from "@/platform/services";
import { buildSystemInfoSections, type VaultGroup, type VaultListItem } from "@upriv/shared";
import { useSystemInfoData, useVaultRootIntegrityClose } from "@upriv/shared/react";
import { InfoFieldList } from "./InfoFieldList";

interface SystemInfoModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
  groups: VaultGroup[];
}

export function SystemInfoModal({ open, onClose, vaults, groups }: SystemInfoModalProps) {
  const { t } = useTranslation();
  const { settings, showHiddenVaultsSession, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const showHiddenVaults = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const vaultRootService = useVaultRootService();

  const getVersion = useCallback(async () => {
    const versionInfo = await getAppVersion();
    return {
      version: versionInfo.version || getSessionAppVersion()?.version || APP_VERSION,
      distribution: versionInfo.distribution ?? null,
      versionOffline: Boolean(versionInfo.offline),
    };
  }, []);

  const { snapshot, loadError, loadFailure, retryLoad } = useSystemInfoData({
    open,
    vaults,
    groups,
    settings,
    vaultRootService,
    getVersion,
    showHiddenVaults,
  });

  useVaultRootIntegrityClose(open, loadFailure, reportVaultRootIntegrityFailure, onClose);

  const sections = useMemo(() => {
    if (!snapshot) return [];
    return buildSystemInfoSections(snapshot, t);
  }, [snapshot, t]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modal.system_info.title")}
      titleIcon="info"
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
