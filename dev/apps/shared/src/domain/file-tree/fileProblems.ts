import type { I18nKey } from "../../i18n/catalog";
import type { TabContent, TabContents } from "../file-manager/tabContents";
import { isRpcError } from "../core-rpc/errors";
import { VAULT_ERROR_CODES } from "../vault/errors/codes";
import { joinPath, visibleTreeRows, type VisibleTreeRow } from "./treeUtils";
import { isFileProblem, type FileProblem, type FileTreeNode } from "./types";

/** The explorer's mark: a file that cannot be read, or a folder above one. */
export type FileProblemMark = FileProblem | "inside";

export const FILE_PROBLEM_MARK_I18N_KEYS = {
  missing: "modal.file_manager.explorer.problem_missing",
  damaged: "modal.file_manager.explorer.problem_damaged",
  inside: "modal.file_manager.explorer.problem_inside",
} as const satisfies Record<FileProblemMark, I18nKey>;

/** What the editor says about a file it cannot open. */
export const FILE_PROBLEM_BODY_I18N_KEYS = {
  missing: "modal.file_manager.viewer.problem_missing_body",
  damaged: "modal.file_manager.viewer.problem_damaged_body",
} as const satisfies Record<FileProblem, I18nKey>;

/**
 * Why a read failed when core found the file's data missing or damaged
 * (`vault_file_unreadable`); null for any other failure.
 */
export function fileProblemOfError(error: unknown): FileProblem | null {
  if (!isRpcError(error) || error.code !== VAULT_ERROR_CODES.FILE_UNREADABLE) return null;
  const details = error.details;
  const problem =
    typeof details === "object" && details !== null
      ? (details as { problem?: unknown }).problem
      : undefined;
  // Core always says which; an answer without it still means the file is unreadable.
  return isFileProblem(problem) ? problem : "damaged";
}

/** The files of a vault tree that cannot be read in full. */
export interface TreeFileProblems {
  /** Each marked file by path, in tree order. */
  files: ReadonlyMap<string, FileProblem>;
  /** Every folder above a marked file. The root is not one of them. */
  folders: ReadonlySet<string>;
}

/**
 * The marked files of `root` and the folders that lead to them; null when
 * every file reads, so a healthy vault keeps nothing.
 */
export function treeFileProblems(root: FileTreeNode): TreeFileProblems | null {
  const files = new Map<string, FileProblem>();
  const folders = new Set<string>();
  const walk = (folder: FileTreeNode, folderPath: string): boolean => {
    let holds = false;
    for (const child of folder.children ?? []) {
      const path = joinPath(folderPath, child.name);
      if (child.type === "folder") {
        if (walk(child, path)) {
          folders.add(path);
          holds = true;
        }
      } else if (child.problem) {
        files.set(path, child.problem);
        holds = true;
      }
    }
    return holds;
  };
  if (root.type === "folder") walk(root, "/");
  return files.size > 0 ? { files, folders } : null;
}

/**
 * Why the editor cannot show `path`: what its read found, or the tree's mark
 * while no read has landed. A read that loaded the file wins over the mark,
 * since core clears the mark of a file it reads in full.
 */
export function editorFileProblem(
  problems: TreeFileProblems | null,
  path: string,
  content: TabContent | undefined,
): FileProblem | null {
  if (content?.state === "loaded") return null;
  if (content?.state === "failed" && content.problem) return content.problem;
  return problems?.files.get(path) ?? null;
}

/**
 * True when an open tab read in full a file the tree still marks: core
 * cleared that mark, so the tree is behind and should be fetched again.
 */
export function treeMarkBehindRead(
  problems: TreeFileProblems | null,
  contents: TabContents,
): boolean {
  if (!problems) return false;
  return Object.entries(contents).some(
    ([path, content]) => content.state === "loaded" && problems.files.has(path),
  );
}

/** The mark the explorer shows on the row at `path`, if any. */
export function fileProblemMark(
  problems: TreeFileProblems | null,
  path: string,
): FileProblemMark | null {
  if (!problems) return null;
  return problems.files.get(path) ?? (problems.folders.has(path) ? "inside" : null);
}

/**
 * The explorer's rows while it shows only the files that cannot be read: the
 * visible rows of those files and of the folders above them. The folders
 * follow the explorer's own expanded state, which showing this view opens.
 */
export function fileProblemRows(
  root: FileTreeNode,
  problems: TreeFileProblems,
  expandedPaths: readonly string[],
): VisibleTreeRow[] {
  return visibleTreeRows(root, expandedPaths).filter(
    (row) => problems.files.has(row.path) || problems.folders.has(row.path),
  );
}
