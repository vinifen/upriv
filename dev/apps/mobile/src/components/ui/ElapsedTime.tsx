import type { ReactNode } from "react";
import { Text, StyleSheet } from "react-native";
import { formatElapsed } from "@upriv/shared";
import { useElapsed } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface ElapsedTimeProps {
  /** When the work started; `null` shows nothing (queued, or no counter). */
  startedAt: number | null;
  /** `inline`: the time alone, for a vault row or a progress line. `block`: a line under a spinner. */
  layout?: "block" | "inline";
  /** Shown instead until the counter appears (a row's last-accessed text). */
  fallback?: ReactNode;
}

/** How long long work has been running, from one second in. Never an estimate. */
export function ElapsedTime({ startedAt, layout = "block", fallback = null }: ElapsedTimeProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const elapsed = useElapsed(startedAt);
  if (!elapsed?.visible) return fallback;
  const time = formatElapsed(elapsed.elapsedMs);
  const label = t("loading.elapsed", { time });
  return (
    <Text
      style={[typography.caption, layout === "inline" ? styles.inline : styles.block]}
      numberOfLines={1}
      accessibilityLabel={label}
    >
      {layout === "inline" ? time : label}
    </Text>
  );
}

const styles = StyleSheet.create({
  block: { textAlign: "center", marginTop: spacing.sm },
  inline: { flexShrink: 0, fontVariant: ["tabular-nums"] },
});
