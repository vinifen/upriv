import { StyleSheet, Text, View } from "react-native";
import {
  jobProgressLine,
  jobProgressPercent,
  type JobProgress,
  type JobProgressCopy,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { ElapsedTime } from "./ElapsedTime";

interface JobProgressBarProps {
  /** `null` until core first answers `job_status`. */
  progress: JobProgress | null;
  /** When core started the job; `null` while it waits for its turn (Queued…). */
  startedAt: number | null;
  /** Names the bar for assistive technology. */
  label: string;
  copy: JobProgressCopy;
}

/**
 * How far a running job got: a bar, then a line with the bytes done of the
 * total and how long it has run.
 */
export function JobProgressBar({ progress, startedAt, label, copy }: JobProgressBarProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const percent = jobProgressPercent(progress);
  const line = jobProgressLine(progress, copy);

  return (
    <>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: percent }}
        style={[styles.track, { backgroundColor: colors.surfaceContainerHighest }]}
      >
        <View
          style={[
            styles.fill,
            { backgroundColor: colors.accent },
            percent === null ? styles.fillMeasuring : { width: `${percent}%` },
          ]}
        />
      </View>
      <View style={styles.line}>
        <Text style={[typography.body, styles.lineText, { color: colors.onSurface }]}>
          {startedAt === null ? t("vault.status.queued") : t(line.key, line.params)}
        </Text>
        <ElapsedTime startedAt={startedAt} layout="inline" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  track: {
    height: spacing.sm,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radii.full },
  fillMeasuring: { width: "25%", opacity: 0.5 },
  line: { flexDirection: "row", alignItems: "baseline", gap: spacing.md },
  lineText: { flex: 1 },
});
