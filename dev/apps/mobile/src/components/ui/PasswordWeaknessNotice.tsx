import { Text } from "react-native";
import { PASSWORD_WEAKNESS_I18N_KEYS, type PasswordWeakness } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

/** One line under a new password saying what is objectively wrong with it. It never blocks. */
export function PasswordWeaknessNotice({ weakness }: { weakness: PasswordWeakness | null }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!weakness) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.caption, { color: colors.onErrorContainer }]}
    >
      {t(PASSWORD_WEAKNESS_I18N_KEYS[weakness])}
    </Text>
  );
}
