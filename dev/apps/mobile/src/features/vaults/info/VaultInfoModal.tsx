import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SettingsAccordionSection } from "@/components/settings";
import { InfoFieldList } from "@/features/system/info/InfoFieldList";
import { Button, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { buildVaultInfoSections, type VaultGroup, type VaultListItem } from "@upriv/shared";
import { useVaultInfoData, useVaultRootIntegrityClose } from "@upriv/shared/react";
import { getMockVaultRuntimeStats } from "@upriv/shared/testing";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import {
  useBackupService,
  useVaultLifecycleService,
  useVaultRootService,
  useVaultService,
} from "@/platform/services";

interface VaultInfoModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  groups?: readonly VaultGroup[];
}

export function VaultInfoModal({ vault, open, onClose, groups = [] }: VaultInfoModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
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
        <View style={styles.sections}>
          {loadError ? (
            <View style={styles.errorWrap}>
              <Text style={[typography.bodyMuted, { color: colors.onSurfaceVariant }]}>
                {t("modal.info.load_error")}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                label={t("modal.info.action.retry")}
                onPress={retryLoad}
              />
            </View>
          ) : null}
          {sections.map((section) => (
            <SettingsAccordionSection key={section.id} title={section.title} defaultOpen>
              <InfoFieldList fields={section.fields} />
            </SettingsAccordionSection>
          ))}
        </View>
      ) : loadError ? (
        <View style={styles.errorWrap}>
          <Text style={[typography.bodyMuted, { color: colors.onSurfaceVariant }]}>
            {t("modal.info.load_error")}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            label={t("modal.info.action.retry")}
            onPress={retryLoad}
          />
        </View>
      ) : (
        <Text style={[typography.bodyMuted, { color: colors.onSurfaceVariant }]}>
          {t("modal.info.loading")}
        </Text>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: spacing.sm,
  },
  errorWrap: {
    gap: spacing.md,
  },
});
