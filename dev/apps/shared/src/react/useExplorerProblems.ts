import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  treeFileProblems,
  type FileTreeNode,
  type TreeFileProblems,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "../domain";
import type { ExplorerSearch } from "./useExplorerSearch";

export interface ExplorerProblems {
  /** The files that cannot be read in full; null when every file reads. */
  problems: TreeFileProblems | null;
  /** The explorer shows only those files and the folders above them. */
  only: boolean;
  /** Show only those files, or every file again. */
  show: (only: boolean) => void;
}

/**
 * The files of one vault that cannot be read in full, and the explorer view
 * that shows only them. Showing it opens the folders that hold them, so they
 * stay easy to find once the view ends, and closes the search bar; opening the
 * search bar ends it. It ends by itself once no file is marked.
 */
export function useExplorerProblems(
  tree: FileTreeNode,
  workspace: Pick<VaultWorkspaceState, "explorerCollapsed" | "explorerSearchOpen">,
  dispatch: (action: VaultWorkspaceAction) => void,
  showSearch: ExplorerSearch["show"],
): ExplorerProblems {
  const problems = useMemo(() => treeFileProblems(tree), [tree]);
  const [only, setOnly] = useState(false);
  const problemsRef = useRef(problems);
  problemsRef.current = problems;
  const collapsedRef = useRef(workspace.explorerCollapsed);
  collapsedRef.current = workspace.explorerCollapsed;

  const show = useCallback(
    (next: boolean) => {
      const current = problemsRef.current;
      if (next && current) {
        for (const path of current.folders) {
          dispatch({ type: "expand_folder", path, force: true });
        }
        if (collapsedRef.current) dispatch({ type: "set_explorer_collapsed", collapsed: false });
        showSearch(false);
      }
      setOnly(next && current !== null);
    },
    [dispatch, showSearch],
  );

  useEffect(() => {
    if (workspace.explorerSearchOpen) setOnly(false);
  }, [workspace.explorerSearchOpen]);

  return { problems, only: only && problems !== null, show };
}
