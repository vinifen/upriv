import { StyleSheet, Text, View } from "react-native";
import { ROW_NAME_MAX_CHARS } from "@upriv/shared";
import { PathField } from "@/components/PathField";
import { ThemedInput } from "@/components/settings/settingsFields";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { shownPath } from "./shownPath";

/** How a row's folder changes: picked on this phone, typed for another device. */
export type RowFolderEdit =
  | {
      kind: "picked";
      /** The folder the row holds now; empty until one is picked. */
      path: string;
      /** Why the folder cannot change now (an open vault holds it); `null` when it can. */
      held: string | null;
      onPick: () => void;
    }
  | { kind: "typed"; path: string; onPath: (path: string) => void };

/**
 * A row's name and folder, edited in place under its text (desktop
 * `RowEditor` parity). This phone's folder is a storage-access grant, so it
 * is picked, never typed: its field shows the folder it holds, read-only
 * with its open button, and Choose folder beside it. Another device's folder
 * is text checked against that device's system. Each edit goes to the
 * window's draft at once, and the window's own Save, Apply, or Continue
 * writes it; Edit in the row's menu closes the fields again.
 */
export function RowEditor({
  name,
  onName,
  folder,
}: {
  name: string;
  onName: (name: string) => void;
  folder: RowFolderEdit;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const label = [typography.caption, styles.label, { color: colors.onSurfaceVariant }];

  return (
    <View style={[styles.editor, { borderTopColor: colors.outlineVariant }]}>
      <View style={styles.field}>
        <Text style={label}>{t("folder_list.field.name")}</Text>
        <ThemedInput
          value={name}
          maxLength={ROW_NAME_MAX_CHARS}
          placeholder={t("folder_list.field.name_placeholder")}
          accessibilityLabel={t("folder_list.field.name")}
          returnKeyType="done"
          blurOnSubmit
          onChangeText={onName}
        />
      </View>
      <View style={styles.field}>
        <Text style={label}>{t("folder_list.field.path")}</Text>
        {folder.kind === "typed" ? (
          <ThemedInput
            mono
            value={folder.path}
            placeholder={t("modal.folder_field.placeholder")}
            accessibilityLabel={t("folder_list.field.path")}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={folder.onPath}
          />
        ) : (
          <>
            <PathField
              value={folder.path.trim() ? shownPath(folder.path) : ""}
              openPath={folder.path}
              editable={false}
              placeholder={t("vault.create.action.choose_folder")}
            />
            {folder.held ? (
              <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
                {folder.held}
              </Text>
            ) : (
              <Button
                label={t("modal.app_settings.action.choose_folder")}
                size="sm"
                variant="secondary"
                icon="folder"
                onPress={folder.onPick}
                style={styles.start}
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  field: { gap: spacing.xs },
  label: { fontWeight: "500" },
  start: { alignSelf: "flex-start" },
});
