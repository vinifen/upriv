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

  const save = () => {
    if (!vault || !selectedPath) return;
    fs.setFileContent(vault.id, selectedPath, content);
    setDirty(false);
    bump();
  };

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
    <RnModal visible={open} animationType="slide" onRequestClose={onClose}>
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
            <Pressable onPress={() => setView("tree")} style={styles.headerBtn}>
              <Text style={[typography.body, { color: colors.accent }]}>
                {t("modal.file_manager.mobile.back_to_tree")}
              </Text>
            </Pressable>
          ) : (
            <Text style={[typography.headline, { flex: 1 }]} numberOfLines={1}>
              {t("modal.file_manager.title", { name: vault.displayName })}
            </Text>
          )}
          <Pressable onPress={onClose} style={styles.headerBtn} accessibilityRole="button">
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
                  value={content}
                  onChangeText={(next) => {
                    setContent(next);
                    setDirty(true);
                  }}
                  multiline
                  style={[
                    styles.editor,
                    typography.body,
                    {
                      backgroundColor: colors.surfaceContainer,
                      borderColor: colors.outlineVariant,
                      color: colors.onSurface,
                    },
                  ]}
                  textAlignVertical="top"
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
    borderWidth: 1,
    padding: spacing.md,
    fontFamily: "monospace",
  },
  preview: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
});
