import { useRef, type ChangeEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { findNode, getParentPath } from "@upriv/shared";
import { filesFromFileInput } from "../lib/osFileDrop";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

/** New and Import land in the selected folder, the selected file's folder, or the vault root. */
function explorerTargetPath(fm: FileManagerApi): string {
  const selected = fm.workspace.selectedPath;
  if (!selected || selected === "/") return "/";
  const node = findNode(fm.tree, selected);
  if (node?.type === "folder") return selected;
  return getParentPath(selected);
}

/** Spread across their own row once the explorer toolbar wraps (`FileTreePanel`). */
const EXPLORER_TOOL_PAIR_CLASS =
  "flex shrink-0 [@container(width<9.5rem)]:flex-1 [@container(width<9.5rem)]:justify-around";

export function ExplorerToolButton({
  icon,
  label,
  pressed,
  active = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  /** A toggle's state. A plain action leaves it out. */
  pressed?: boolean;
  /** Still at work with its panel closed. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors",
        pressed
          ? "bg-surface-container-highest text-on-surface"
          : active
            ? "text-[var(--accent)] hover:bg-surface-container-highest"
            : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
      ].join(" ")}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** A labeled explorer button, for the editor area while no file is open. */
export function ExplorerLabeledButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" className="gap-1.5" onClick={onClick}>
      <Icon name={icon} size={14} className="shrink-0" />
      {label}
    </Button>
  );
}

interface ExplorerAction {
  icon: IconName;
  /** The toolbar's tooltip and accessible name. */
  label: string;
  /** The name on a labeled button. */
  name: string;
  run: () => void;
}

/**
 * New file, New folder, Import files, Import folder. `toolbar` draws the
 * explorer's icon pairs; `labeled` draws them with their names.
 */
export function ExplorerActions({
  fm,
  variant,
}: {
  fm: FileManagerApi;
  variant: "toolbar" | "labeled";
}) {
  const { t } = useTranslation();
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const importPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = filesFromFileInput(event.target.files);
    event.target.value = "";
    if (files.length === 0) return;
    void fm.importFiles(explorerTargetPath(fm), files, { openFirstViewable: true });
  };

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
        run: () => filesInputRef.current?.click(),
      },
      {
        icon: "archive",
        label: t("modal.file_manager.explorer.import_folder"),
        name: t("modal.file_manager.viewer.empty_import_folder"),
        run: () => folderInputRef.current?.click(),
      },
    ],
  ];

  return (
    <>
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={importPicked}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        // @ts-expect-error — non-standard directory picker attribute (Chromium, Firefox, Safari)
        webkitdirectory=""
        directory=""
        onChange={importPicked}
      />
      {pairs.map((pair, index) =>
        variant === "toolbar" ? (
          <div key={index} className={EXPLORER_TOOL_PAIR_CLASS}>
            {pair.map((action) => (
              <ExplorerToolButton
                key={action.icon}
                icon={action.icon}
                label={action.label}
                onClick={action.run}
              />
            ))}
          </div>
        ) : (
          pair.map((action) => (
            <ExplorerLabeledButton
              key={action.icon}
              icon={action.icon}
              label={action.name}
              onClick={action.run}
            />
          ))
        ),
      )}
    </>
  );
}
