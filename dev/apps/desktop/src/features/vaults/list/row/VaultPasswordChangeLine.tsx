import { vaultPasswordChangeLineKey, type VaultListItem } from "@upriv/shared";
import { useTranslation } from "@/i18n";

/**
 * A password change that did not finish (the row is in recovery and the
 * unlock asks for the new password), or one whose files still wait for
 * Finish in the vault's Password settings. Nothing for a steady vault.
 */
export function VaultPasswordChangeLine({ vault }: { vault: VaultListItem }) {
  const { t } = useTranslation();
  const key = vaultPasswordChangeLineKey(vault);
  if (!key) return null;
  return (
    <p
      className={[
        "min-w-0 truncate text-xs",
        vault.passwordChange === "pending" ? "text-on-error-container" : "text-on-surface-variant",
      ].join(" ")}
      title={t(key)}
    >
      {t(key)}
    </p>
  );
}
