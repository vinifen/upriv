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

interface JobProgressBarProps {
  /** `null` until core first answers `job_status`. */
  progress: JobProgress | null;
  /** Names the bar for assistive technology. */
  label: string;
  copy: JobProgressCopy;
}

/** How far a running job got: a bar, then a line with the bytes done of the total. */
export function JobProgressBar({ progress, label, copy }: JobProgressBarProps) {
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
      <Text style={[typography.body, { color: colors.onSurface }]}>{t(line.key, line.params)}</Text>
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
});
