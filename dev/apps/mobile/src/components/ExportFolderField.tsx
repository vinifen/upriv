import { StyleSheet, Text, View } from "react-native";
import { workspacePathDisplay } from "@upriv/shared";
import { PathField } from "@/components/PathField";
import { FieldHint, FieldLabel } from "@/components/settings";
import { Button } from "@/components/ui";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface ExportFolderFieldProps {
  folder: ExportFolder;
  /** Under the label: what the export writes there. */
  hint?: string;
  /** Locked while the export runs. */
  disabled?: boolean;
  /** The picker answered with a folder. */
  onPicked?: (folder: string) => void;
}

/**
 * Where an export goes: a folder from the picker. The export itself starts
 * from its window's own button.
 */
export function ExportFolderField({
  folder,
  hint,
  disabled = false,
  onPicked,
}: ExportFolderFieldProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  return (
    <View style={styles.group}>
      <FieldLabel>{t("modal.export_folder.label")}</FieldLabel>
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <PathField
        value={workspacePathDisplay(folder.path)}
        openPath={folder.path}
        editable={false}
        placeholder={t("modal.export_folder.none")}
      />
      <Button
        size="sm"
        variant="ghost"
        label={t("modal.export_folder.choose")}
        disabled={disabled || folder.picking}
        busy={folder.picking}
        onPress={() => folder.choose(onPicked)}
      />
      {folder.pickFailed ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: colors.onErrorContainer }]}
        >
          {t("error.unexpected")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
});
