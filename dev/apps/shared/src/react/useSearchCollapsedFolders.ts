import { useCallback, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/**
 * Folders collapsed in the results of an explorer search. A convenience for this
 * search only: a new query, another vault, or a new mount starts with every folder
 * open. It lives here so it never reaches the saved layout or the folders expanded
 * outside a search.
 */
export function useSearchCollapsedFolders(vaultId: string, query: string) {
  const key = `${vaultId}\0${query}`;
  const [state, setState] = useState({ key, paths: NONE });
  const collapsed = state.key === key ? state.paths : NONE;

  const toggle = useCallback(
    (path: string) => {
      setState((current) => {
        const paths = new Set(current.key === key ? current.paths : NONE);
        if (!paths.delete(path)) paths.add(path);
        return { key, paths };
      });
    },
    [key],
  );

  return { collapsed, toggle };
}
