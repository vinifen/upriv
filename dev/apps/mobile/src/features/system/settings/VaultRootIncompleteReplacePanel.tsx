import { StyleSheet, Text, View } from "react-native";
import type { IncompleteReplacePolicy } from "@upriv/shared";
import { PolicyRadioOption } from "@/components/settings/PolicyRadioOption";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface VaultRootIncompleteReplacePanelProps {
  /** The folder whose `.upriv/` is broken, as the screen names it. */
  folder: string;
  replacePolicy: IncompleteReplacePolicy | null;
  onReplacePolicyChange: (policy: IncompleteReplacePolicy) => void;
  /** Disable the policy radios while the window's work runs. */
  disabled?: boolean;
}

/**
 * The choice for a broken `.upriv/` in the folder the data folder list
 * selects (Setup, Repair, the Data folder window): reset its settings,
 * rename it aside, or delete it. The primary action waits until one is chosen.
 */
export function VaultRootIncompleteReplacePanel({
  folder,
  replacePolicy,
  onReplacePolicyChange,
  disabled = false,
}: VaultRootIncompleteReplacePanelProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={typography.caption} accessibilityRole="text">
        {t("modal.data_folder.incomplete_notice", { path: folder })}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("modal.vault_root_gate.incomplete_replace_options")}
        style={styles.options}
      >
        <PolicyRadioOption
          value="reset_settings"
          checked={replacePolicy === "reset_settings"}
          title={t("modal.vault_root_repair.option_reset_settings")}
          description={t("modal.vault_root_repair.reset_settings_hint")}
          badge="default"
          disabled={disabled}
          onSelect={() => onReplacePolicyChange("reset_settings")}
        />
        <PolicyRadioOption
          value="rename"
          checked={replacePolicy === "rename"}
          title={t("modal.vault_root_repair.option_rename")}
          description={t("modal.vault_root_repair.rename_hint")}
          disabled={disabled}
          onSelect={() => onReplacePolicyChange("rename")}
        />
        <PolicyRadioOption
          value="delete"
          checked={replacePolicy === "delete"}
          title={t("modal.vault_root_repair.option_delete")}
          description={t("modal.vault_root_repair.delete_hint")}
          tone="less-secure"
          disabled={disabled}
          onSelect={() => onReplacePolicyChange("delete")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  options: { gap: spacing.sm },
});
