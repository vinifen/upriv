import { Text } from "react-native";
import { vaultPasswordChangeLineKey, type VaultListItem } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

/**
 * A password change that did not finish (the row is in recovery and the
 * unlock asks for the new password), or one whose files still wait for
 * Finish in the vault's Password settings. Nothing for a steady vault.
 */
export function VaultPasswordChangeLine({ vault }: { vault: VaultListItem }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const key = vaultPasswordChangeLineKey(vault);
  if (!key) return null;
  return (
    <Text
      numberOfLines={2}
      style={[
        typography.caption,
        {
          color:
            vault.passwordChange === "pending" ? colors.onErrorContainer : colors.onSurfaceVariant,
        },
      ]}
    >
      {t(key)}
    </Text>
  );
}
