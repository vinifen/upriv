import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ROW_ROLE_GUARD_MS } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { spacing } from "@/theme/tokens";
import { Button } from "./Button";
import { ElapsedTime } from "./ElapsedTime";

interface JobStopButtonProps {
  /** When Stop was asked for; the button then says Stopping… and counts. */
  stoppingSince: number | null;
  /** False in the step the job cannot stop: the button is disabled and says why. */
  stoppable: boolean;
  onStop: () => void;
  /** Defaults to Stop / Stopping…. */
  label?: string;
  stoppingLabel?: string;
  size?: "sm" | "md";
}

/**
 * The Stop a window's footer shows in place of the button that started a job.
 * One tap stops. Taps in its first `ROW_ROLE_GUARD_MS` are ignored, so the
 * second half of a double tap on the start button never stops the job.
 */
export function JobStopButton({
  stoppingSince,
  stoppable,
  onStop,
  label,
  stoppingLabel,
  size = "md",
}: JobStopButtonProps) {
  const { t } = useTranslation();
  const [shownAt] = useState(() => Date.now());
  const stopping = stoppingSince !== null;
  return (
    <View style={styles.row}>
      {stopping ? <ElapsedTime startedAt={stoppingSince} layout="inline" /> : null}
      <Button
        variant="secondary"
        size={size}
        label={
          stopping ? (stoppingLabel ?? t("vault.status.stopping")) : (label ?? t("action.stop"))
        }
        disabled={stopping || !stoppable}
        busy={stopping}
        accessibilityHint={!stopping && !stoppable ? t("action.stop_final") : undefined}
        onPress={() => {
          if (Date.now() - shownAt < ROW_ROLE_GUARD_MS) return;
          onStop();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
