import { useId } from "react";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { VAULT_ROOT_ALIAS_FILE, type IncompleteReplacePolicy } from "@upriv/shared";
import type { VaultRootConfirmAction } from "./vaultRootSettingsIntent";

type IncompleteContext = { kind: "default_root" } | { kind: "custom_root"; path: string };

interface VaultRootIncompleteReplacePanelProps {
  context: IncompleteContext;
  replacePolicy: IncompleteReplacePolicy | null;
  onReplacePolicyChange: (policy: IncompleteReplacePolicy) => void;
  /** Optional shared radiogroup name (defaults to a unique id). */
  groupName?: string;
  /**
   * Required: Setup / Repair / Recovery use `"continue"`; Data folder uses `"apply"`.
   * No default — callers must choose so Apply/Continue copy cannot drift by accident.
   */
  primaryAction: VaultRootConfirmAction;
}

/**
 * Shared “incomplete `.upriv/`” panel (Data folder, Setup, Repair).
 * Rename / delete radios under the active vault-root option — not a separate modal step.
 */
export function VaultRootIncompleteReplacePanel({
  context,
  replacePolicy,
  onReplacePolicyChange,
  groupName,
  primaryAction,
}: VaultRootIncompleteReplacePanelProps) {
  const { t } = useTranslation();
  const fallbackGroup = useId();
  const repairPolicyGroup = groupName ?? fallbackGroup;
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
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-on-surface" role="status">
        {notice}
      </p>
      <div
        role="radiogroup"
        aria-label={t("modal.vault_root_gate.incomplete_replace_options")}
        className="grid gap-2"
      >
        <PolicyRadioOption
          groupName={repairPolicyGroup}
          value="rename"
          checked={replacePolicy === "rename"}
          title={t("modal.vault_root_repair.option_rename")}
          description={t("modal.vault_root_repair.rename_hint")}
          badge="default"
          onSelect={() => onReplacePolicyChange("rename")}
        />
        <PolicyRadioOption
          groupName={repairPolicyGroup}
          value="delete"
          checked={replacePolicy === "delete"}
          title={t("modal.vault_root_repair.option_delete")}
          description={t("modal.vault_root_repair.delete_hint")}
          tone="less-secure"
          onSelect={() => onReplacePolicyChange("delete")}
        />
      </div>
    </div>
  );
}
