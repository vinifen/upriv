import { Text } from "react-native";
import type { StatusLine as StatusLineValue } from "@upriv/shared";
import { useTheme } from "@/theme";

/** A row's status, under its path: muted while checking or ready, in the error color for a problem. */
export function StatusLine({ line }: { line: StatusLineValue }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      accessibilityRole={line.tone === "problem" ? "alert" : "text"}
      style={[
        typography.caption,
        { color: line.tone === "problem" ? colors.onErrorContainer : colors.onSurfaceVariant },
      ]}
    >
      {line.text}
    </Text>
  );
}
