import { StyleSheet, View } from "react-native";
import { findNode, getParentPath } from "@upriv/shared";
import type { IconName } from "@/components/icons";
import { Button, IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import {
  DocumentPickerUnavailableError,
  FolderPickerUnavailableError,
  pickImportFiles,
} from "../lib/osFileImport";

/** Explorer toggle icon and each toolbar action are this square. */
export const TOOL_BUTTON_SIZE = 24;

/** New and Import land in the selected folder, the selected file's folder, or the vault root. */
function explorerTargetPath(fm: FileManagerApi): string {
  const selected = fm.workspace.selectedPath;
  if (!selected || selected === "/") return "/";
  const node = findNode(fm.tree, selected);
  if (node?.type === "folder") return selected;
  return getParentPath(selected);
}

async function importPickedFiles(fm: FileManagerApi, t: ReturnType<typeof useTranslation>["t"]) {
  try {
    const result = await pickImportFiles();
    if (!result) return;
    await fm.importFiles(explorerTargetPath(fm), result.files, {
      openFirstViewable: true,
      skippedUnsupported: result.skippedUnsupported,
      releaseSafTree: result.releaseSafTree,
    });
  } catch (error) {
    if (error instanceof FolderPickerUnavailableError) {
      fm.showToast(t("modal.file_manager.toast.import_folder_unavailable"));
      return;
    }
    if (error instanceof DocumentPickerUnavailableError) {
      fm.showToast(t("modal.file_manager.toast.import_unavailable"));
      return;
    }
    const failedName =
      error instanceof Error && error.name === "ImportReadError" ? error.message : "file";
    fm.showToast(t("modal.file_manager.toast.import_failed", { name: failedName }));
  }
}

interface ExplorerAction {
  icon: IconName;
  /** The toolbar's accessible name. */
  label: string;
  /** The name on a labeled button. */
  name: string;
  run: () => void;
}

/**
 * New file, New folder, Import files, Import folder. `toolbar` draws the
 * explorer's icon pairs (spread across their own rows once `wrapped`);
 * `labeled` draws them with their names.
 */
export function ExplorerActions({
  fm,
  variant,
  wrapped = false,
}: {
  fm: FileManagerApi;
  variant: "toolbar" | "labeled";
  wrapped?: boolean;
}) {
  const { t } = useTranslation();
  const newFile = t("modal.file_manager.context.new_file");
  const newFolder = t("modal.file_manager.context.new_folder");
  const pairs: ExplorerAction[][] = [
    [
      {
        icon: "file",
        label: newFile,
        name: newFile,
        run: () => fm.createFile(explorerTargetPath(fm)),
      },
      {
        icon: "folder",
        label: newFolder,
        name: newFolder,
        run: () => fm.createFolder(explorerTargetPath(fm)),
      },
    ],
    [
      {
        icon: "arrow-up",
        label: t("modal.file_manager.explorer.import_files"),
        name: t("modal.file_manager.viewer.empty_import_files"),
        run: () => {
          void importPickedFiles(fm, t);
        },
      },
      {
        icon: "archive",
        label: t("modal.file_manager.explorer.import_folder"),
        name: t("modal.file_manager.viewer.empty_import_folder"),
        run: () => {
          void fm.importPickedFolder(explorerTargetPath(fm));
        },
      },
    ],
  ];

  if (variant === "labeled") {
    return (
      <>
        {pairs.flat().map((action) => (
          <Button
            key={action.icon}
            label={action.name}
            icon={action.icon}
            variant="ghost"
            size="sm"
            onPress={action.run}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {pairs.map((pair, index) => (
        <View key={index} style={[styles.pair, wrapped && styles.pairWrapped]}>
          {pair.map((action) => (
            <IconButton
              key={action.icon}
              label={action.label}
              icon={action.icon}
              size={14}
              tone="muted"
              onPress={action.run}
              style={styles.toolButton}
            />
          ))}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", flexShrink: 0 },
  pairWrapped: { flexGrow: 1, justifyContent: "space-around" },
  toolButton: {
    width: TOOL_BUTTON_SIZE,
    height: TOOL_BUTTON_SIZE,
    minWidth: TOOL_BUTTON_SIZE,
    minHeight: TOOL_BUTTON_SIZE,
    padding: 0,
  },
});
