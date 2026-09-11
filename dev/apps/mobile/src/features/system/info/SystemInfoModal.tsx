import { useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SettingsAccordionSection } from "@/components/settings";
import { Button, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { getMobileAppVersion } from "@/lib/appVersion";
import { useVaultRootService } from "@/platform/services";
import { buildSystemInfoSections, type VaultGroup, type VaultListItem } from "@upriv/shared";
import { useSystemInfoData, useVaultRootIntegrityClose } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { InfoFieldList } from "./InfoFieldList";

interface SystemInfoModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
  groups: VaultGroup[];
}

export function SystemInfoModal({ open, onClose, vaults, groups }: SystemInfoModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { settings, showHiddenVaultsSession, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const showHiddenVaults = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const vaultRootService = useVaultRootService();

  const getVersion = useCallback(() => {
    const versionInfo = getMobileAppVersion();
    return {
      version: versionInfo.version,
      distribution: versionInfo.distribution,
      versionOffline: versionInfo.offline,
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
