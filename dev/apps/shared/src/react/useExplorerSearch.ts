import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { VaultWorkspaceAction, VaultWorkspaceState } from "../domain";

export interface ExplorerSearch {
  /**
   * A button opened the bar, so typing starts there. The explorer reads and
   * clears it whenever the bar opens or `focusTick` moves; a bar the layout
   * restores leaves focus alone.
   */
  focusRef: MutableRefObject<boolean>;
  focusTick: number;
  /** Open the bar, showing a hidden explorer first, or close it. */
  show: (open: boolean) => void;
  toggle: () => void;
}

/** The explorer search bar of one vault's file manager, opened from any of its buttons. */
export function useExplorerSearch(
  workspace: VaultWorkspaceState,
  dispatch: (action: VaultWorkspaceAction) => void,
): ExplorerSearch {
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const focusRef = useRef(false);
  const [focusTick, setFocusTick] = useState(0);

  const show = useCallback(
    (open: boolean) => {
      focusRef.current = open;
      if (open) {
        if (workspaceRef.current.explorerCollapsed) {
          dispatch({ type: "set_explorer_collapsed", collapsed: false });
        }
        setFocusTick((tick) => tick + 1);
      }
      dispatch({ type: "set_explorer_search_open", open });
    },
    [dispatch],
  );
  const toggle = useCallback(() => show(!workspaceRef.current.explorerSearchOpen), [show]);

  return { focusRef, focusTick, show, toggle };
}
