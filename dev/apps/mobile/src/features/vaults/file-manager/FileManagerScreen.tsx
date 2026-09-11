import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal as RnModal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FileTreeNode, VaultListItem } from "@upriv/shared";
import { useVaultFileSystemService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { radii, spacing, touchMin } from "@/theme/tokens";

interface FileManagerScreenProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
}

interface FlatEntry {
  path: string;
  name: string;
  type: "file" | "folder";
  depth: number;
}

function walk(node: FileTreeNode, base: string, depth: number, out: FlatEntry[]): void {
  for (const child of node.children ?? []) {
    const path = base === "/" ? `/${child.name}` : `${base}/${child.name}`;
    out.push({ path, name: child.name, type: child.type, depth });
    if (child.type === "folder") {
      walk(child, path, depth + 1, out);
    }
  }
}

export function FileManagerScreen({ vault, open, onClose }: FileManagerScreenProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const fs = useVaultFileSystemService();
  const insets = useSafeAreaInsets();
  const [revision, setRevision] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"tree" | "editor">("tree");

  const tree = useMemo(() => {
    if (!vault || !open) return null;
    void revision;
    return fs.getFileTree(vault.id);
  }, [fs, open, revision, vault]);

  const entries = useMemo(() => {
    if (!tree) return [];
    const out: FlatEntry[] = [];
    walk(tree, "/", 0, out);
    return out;
  }, [tree]);

  useEffect(() => {
    if (!open) {
      setSelectedPath(null);
      setContent("");
      setDirty(false);
      setView("tree");
    }
  }, [open, vault?.id]);

  const bump = useCallback(() => {
    if (!vault) return;
    setRevision(fs.getTreeRevision(vault.id));
  }, [fs, vault]);

  const openFile = (path: string) => {
    if (!vault) return;
    if (!fs.isFileViewable(vault.id, path)) {
      Alert.alert(t("modal.file_manager.viewer.preview_unavailable_kicker"));
      return;
    }
    const file = fs.getFileContent(vault.id, path);
    setSelectedPath(path);
    setContent(file?.content ?? "");
    setDirty(false);
    setView("editor");
  };

  const save = useCallback(() => {
    if (!vault || !selectedPath) return;
    fs.setFileContent(vault.id, selectedPath, content);
    setDirty(false);
    bump();
  }, [bump, content, fs, selectedPath, vault]);

  const closeWithUnsavedPrompt = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert(t("modal.file_manager.unsaved.title"), t("modal.file_manager.unsaved.body"), [
      { text: t("action.cancel"), style: "cancel" },
      {
        text: t("modal.file_manager.unsaved.discard"),
        style: "destructive",
        onPress: onClose,
      },
      {
        text: t("modal.file_manager.unsaved.save_and_close"),
        onPress: () => {
          save();
          onClose();
        },
      },
    ]);
  }, [dirty, onClose, save, t]);

  const createFile = () => {
    if (!vault) return;
    const path = fs.createFile(vault.id, "/", t("modal.file_manager.default.new_file"));
    bump();
    if (path) openFile(path);
  };

  const createFolder = () => {
    if (!vault) return;
    fs.createFolder(vault.id, "/", t("modal.file_manager.default.new_folder"));
    bump();
  };

  const deleteSelected = (path: string) => {
    if (!vault) return;
    Alert.alert(t("modal.file_manager.delete.title"), path, [
      { text: t("action.cancel"), style: "cancel" },
      {
        text: t("modal.file_manager.context.delete"),
        style: "destructive",
        onPress: () => {
          fs.deletePath(vault.id, path);
          if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) {
            setSelectedPath(null);
            setContent("");
            setView("tree");
          }
          bump();
        },
      },
    ]);
  };

  const renderItem: ListRenderItem<FlatEntry> = ({ item }) => (
    <Pressable
      onPress={() => {
        if (item.type === "folder") return;
        openFile(item.path);
      }}
      onLongPress={() => deleteSelected(item.path)}
      style={[
        styles.row,
        {
          paddingLeft: spacing.lg + item.depth * spacing.lg,
          borderBottomColor: colors.outlineVariant,
        },
      ]}
    >
      <Text style={[typography.body, { color: colors.onSurfaceVariant, width: 16 }]}>
        {item.type === "folder" ? "▸" : "·"}
      </Text>
      <Text style={[typography.body, { flex: 1 }]} numberOfLines={1}>
        {item.name}
      </Text>
    </Pressable>
  );

  if (!open || !vault) return null;

  return (
    <RnModal visible={open} animationType="slide" onRequestClose={closeWithUnsavedPrompt}>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            backgroundColor: colors.background,
          },
        ]}
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.outlineVariant,
              backgroundColor: colors.surfaceContainer,
            },
          ]}
        >
          {view === "editor" ? (
            <>
              <Pressable onPress={() => setView("tree")} style={styles.headerBtn}>
                <Text style={[typography.body, { color: colors.accent }]}>
                  {t("modal.file_manager.mobile.back_to_tree")}
                </Text>
              </Pressable>
              <Text
                style={[
                  typography.headline,
                  styles.headerContext,
                  { color: colors.onSurfaceVariant, fontWeight: "500" },
                ]}
                numberOfLines={1}
              >
                {vault.displayName}
              </Text>
            </>
          ) : (
            <View style={styles.headerLeading}>
              <Icon name="file-manager" size={16} color={colors.onSurfaceVariant} />
              <Text
                style={[typography.headline, styles.headerTitle, styles.headerType]}
                numberOfLines={1}
              >
                {t("modal.file_manager.title")}
              </Text>
              <Text
                style={[styles.headerSeparator, { color: colors.onSurfaceVariant }]}
                accessible={false}
              >
                —
              </Text>
              <Text
                style={[styles.headerContext, { color: colors.onSurfaceVariant }]}
                numberOfLines={1}
              >
                {vault.displayName}
              </Text>
            </View>
          )}
          <Pressable
            onPress={closeWithUnsavedPrompt}
            style={styles.headerBtn}
            accessibilityRole="button"
          >
            <Text style={[typography.body, { color: colors.accent }]}>✕</Text>
          </Pressable>
        </View>

        {view === "tree" ? (
          <>
            <View style={[styles.toolbar, { borderBottomColor: colors.outlineVariant }]}>
              <Button
                size="sm"
                label={t("modal.file_manager.context.new_file")}
                onPress={createFile}
              />
              <Button
                size="sm"
                variant="ghost"
                label={t("modal.file_manager.context.new_folder")}
                onPress={createFolder}
              />
            </View>
            <FlatList
              data={entries}
              keyExtractor={(item) => item.path}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              ListEmptyComponent={
                <Text style={[typography.bodyMuted, styles.empty]}>
                  {t("modal.file_manager.viewer.empty_body")}
                </Text>
              }
              contentContainerStyle={styles.list}
            />
          </>
        ) : (
          <View style={styles.editorWrap}>
            <Text style={typography.caption} numberOfLines={1}>
              {selectedPath}
            </Text>
            {selectedPath && fs.isFileEditable(vault.id, selectedPath) ? (
              <>
                <TextInput
                  collapsable={false}
                  value={content}
                  onChangeText={(next) => {
                    setContent(next);
                    setDirty(true);
                  }}
                  multiline
                  blurOnSubmit={false}
                  importantForAutofill="no"
                  style={[
                    styles.editor,
                    typography.body,
                    {
                      backgroundColor: colors.surfaceContainer,
                      color: colors.onSurface,
                    },
                  ]}
                  textAlignVertical="top"
                  underlineColorAndroid="transparent"
                />
                <View style={[styles.toolbar, { borderBottomColor: colors.outlineVariant }]}>
                  <Button
                    label={t("modal.file_manager.viewer.save")}
                    variant="accent"
                    disabled={!dirty}
                    onPress={save}
                  />
                </View>
              </>
            ) : (
              <View style={[styles.preview, { backgroundColor: colors.surfaceContainer }]}>
                <Text style={typography.body}>{content || "—"}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </RnModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    minHeight: touchMin + spacing.sm,
    gap: spacing.sm,
  },
  headerBtn: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: spacing.sm },
  headerLeading: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerType: {
    includeFontPadding: false,
    textAlignVertical: "center",
    lineHeight: 18,
  },
  headerTitle: { flexShrink: 0 },
  headerSeparator: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  headerContext: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
  },
  list: { paddingBottom: spacing.xxl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: touchMin,
    paddingRight: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { padding: spacing.xl, textAlign: "center" },
  editorWrap: { flex: 1, padding: spacing.md, gap: spacing.sm },
  editor: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    fontFamily: "monospace",
  },
  preview: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
});
