import { StyleSheet, Text, View } from "react-native";
import {
  VAULT_ROOT_ALIAS_FILE,
  type IncompleteReplacePolicy,
  type VaultRootConfirmAction,
} from "@upriv/shared";
import { PolicyRadioOption } from "@/components/settings/PolicyRadioOption";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

type IncompleteContext = { kind: "default_root" } | { kind: "custom_root"; path: string };

interface VaultRootIncompleteReplacePanelProps {
  context: IncompleteContext;
  replacePolicy: IncompleteReplacePolicy | null;
  onReplacePolicyChange: (policy: IncompleteReplacePolicy) => void;
  /**
   * Setup / Repair / Recovery use `"continue"`; Data folder uses `"apply"`.
   * Required so Apply/Continue copy cannot drift by accident.
   */
  primaryAction: VaultRootConfirmAction;
}

/**
 * Shared "incomplete `.upriv/`" panel (Data folder, Setup, Repair).
 * Rename / delete radios under the active vault-root option — not a separate modal step.
 */
export function VaultRootIncompleteReplacePanel({
  context,
  replacePolicy,
  onReplacePolicyChange,
  primaryAction,
}: VaultRootIncompleteReplacePanelProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const isApply = primaryAction === "apply";

  const notice =
    context.kind === "default_root"
      ? t(
          isApply
            ? "modal.app_settings.upriv_root.switch_default_root_replace_notice_apply"
            : "modal.app_settings.upriv_root.switch_default_root_replace_notice_continue",
          { file: VAULT_ROOT_ALIAS_FILE },
        )
      : t(
          isApply
            ? "modal.app_settings.apply_confirm_custom_incomplete"
            : "modal.app_settings.continue_confirm_custom_incomplete",
          { path: context.path.trim() || "…" },
        );

  return (
    <View style={styles.wrap}>
      <Text style={typography.caption} accessibilityRole="text">
        {notice}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("modal.vault_root_gate.incomplete_replace_options")}
        style={styles.options}
      >
        <PolicyRadioOption
          value="rename"
          checked={replacePolicy === "rename"}
          title={t("modal.vault_root_repair.option_rename")}
          description={t("modal.vault_root_repair.rename_hint")}
          badge="default"
          onSelect={() => onReplacePolicyChange("rename")}
        />
        <PolicyRadioOption
          value="delete"
          checked={replacePolicy === "delete"}
          title={t("modal.vault_root_repair.option_delete")}
          description={t("modal.vault_root_repair.delete_hint")}
          tone="less-secure"
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
