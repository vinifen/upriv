import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { deviceName, unreachablePlainRecord, type VaultListItem } from "@upriv/shared";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface VaultPlainRecordLineProps {
  vault: VaultListItem;
  /** Check the recorded folders again (a list refresh). */
  onRetry: () => void;
  /** Drop the record: its files stay on that drive. */
  onForget: (vault: VaultListItem, token: string) => void;
}

/**
 * A plain-text folder on record that this phone cannot reach keeps the vault
 * from opening: the row names its device and folder, with Retry and Forget,
 * which asks first.
 */
export function VaultPlainRecordLine({ vault, onRetry, onForget }: VaultPlainRecordLineProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [asking, setAsking] = useState(false);
  const record = unreachablePlainRecord(vault.plainRecords ?? []);
  if (!record) return null;
  const device = deviceName(record.device.id, record.device.system, t);
  const message =
    record.state === "elsewhere"
      ? t("plain.record.elsewhere", { device, path: record.path })
      : t("plain.record.away", { device, path: record.path });
  return (
    // A tap here acts on the record, never on the row.
    <View style={styles.line} onStartShouldSetResponder={() => true}>
      <Text
        accessibilityRole="alert"
        style={[typography.caption, { color: colors.onErrorContainer }]}
      >
        {asking ? t("plain.record.forget_confirm") : message}
      </Text>
      <View style={styles.actions}>
        {asking ? (
          <>
            <Button
              label={t("plain.record.forget")}
              variant="danger"
              size="sm"
              onPress={() => {
                setAsking(false);
                onForget(vault, record.token);
              }}
            />
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => setAsking(false)}
            />
          </>
        ) : (
          <>
            <Button label={t("action.retry")} variant="secondary" size="sm" onPress={onRetry} />
            <Button
              label={t("plain.record.forget")}
              variant="ghost"
              size="sm"
              onPress={() => setAsking(true)}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { gap: spacing.xs, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
