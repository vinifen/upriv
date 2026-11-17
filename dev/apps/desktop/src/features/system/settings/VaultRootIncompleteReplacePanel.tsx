import { useId } from "react";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import type { IncompleteReplacePolicy } from "@upriv/shared";

interface VaultRootIncompleteReplacePanelProps {
  /** The folder whose `.upriv/` is broken. */
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
  const groupName = useId();

  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-on-surface" role="status">
        {t("modal.data_folder.incomplete_notice", { path: folder })}
      </p>
      <div
        role="radiogroup"
        aria-label={t("modal.vault_root_gate.incomplete_replace_options")}
        className="grid gap-2"
      >
        <PolicyRadioOption
          groupName={groupName}
          value="reset_settings"
          checked={replacePolicy === "reset_settings"}
          title={t("modal.vault_root_repair.option_reset_settings")}
          description={t("modal.vault_root_repair.reset_settings_hint")}
          badge="default"
          disabled={disabled}
          onSelect={() => onReplacePolicyChange("reset_settings")}
        />
        <PolicyRadioOption
          groupName={groupName}
          value="rename"
          checked={replacePolicy === "rename"}
          title={t("modal.vault_root_repair.option_rename")}
          description={t("modal.vault_root_repair.rename_hint")}
          disabled={disabled}
          onSelect={() => onReplacePolicyChange("rename")}
        />
        <PolicyRadioOption
          groupName={groupName}
          value="delete"
          checked={replacePolicy === "delete"}
          title={t("modal.vault_root_repair.option_delete")}
          description={t("modal.vault_root_repair.delete_hint")}
          tone="less-secure"
          disabled={disabled}
          onSelect={() => onReplacePolicyChange("delete")}
        />
      </div>
    </div>
  );
}
