import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilePreviewTooLargeError,
  isImportQueueSlotPath,
  isImportWalkPlaceholderPath,
  markTabRecent,
  TAB_CONTENT_CACHE_CHARS,
  tabContentsToLoad,
  tabsNeedingContent,
  trimTabContents,
  withSavedDrafts,
  withTabContent,
  type TabContent,
  type TabContents,
  type VaultFileSystemService,
  type VaultWorkspaceState,
} from "@upriv/shared";

interface UseOpenTabContentsOptions {
  fs: Pick<VaultFileSystemService, "getFileContent" | "isFileViewable" | "previewFits">;
  vaultId: string;
  workspace: VaultWorkspaceState;
  /** Imports still writing. Their tabs are read once the file lands. */
  unresolvedImportPaths: ReadonlySet<string>;
  /** A read failed (the editor shows that tab's error). */
  onReadFailed: () => void;
}

async function readTabContent(
  fs: UseOpenTabContentsOptions["fs"],
  vaultId: string,
  path: string,
  revision: number,
  /** A tab already on screen keeps being read, so low RAM cannot take its text away. */
  alreadyShown: boolean,
): Promise<TabContent> {
  if (!fs.isFileViewable(vaultId, path)) return { state: "loaded", text: "", revision };
  try {
    if (!alreadyShown && !(await fs.previewFits(vaultId, path))) {
      return { state: "too_large", revision };
    }
    const file = await fs.getFileContent(vaultId, path);
    return { state: "loaded", text: file?.content ?? "", revision };
  } catch (error) {
    if (error instanceof FilePreviewTooLargeError) return { state: "too_large", revision };
    return { state: "failed", revision };
  }
}

/**
 * Open tabs' file content, read when needed: the tab on screen and every
 * unsaved tab. Other tabs keep what was read while it fits
 * {@link TAB_CONTENT_CACHE_CHARS}, so opening a tab reads one file and many
 * open tabs do not hold every file in RAM. A tree change reads the needed tabs
 * again and leaves the text on screen until the new read lands.
 */
export function useOpenTabContents({
  fs,
  vaultId,
  workspace,
  unresolvedImportPaths,
  onReadFailed,
}: UseOpenTabContentsOptions) {
  const { activeTabPath, dirtyPaths, editorDrafts, openTabs, treeRevision } = workspace;
  const [contents, setContents] = useState<TabContents>({});
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const revisionRef = useRef(treeRevision);
  revisionRef.current = treeRevision;
  const onReadFailedRef = useRef(onReadFailed);
  onReadFailedRef.current = onReadFailed;
  /** Most recently shown first. */
  const recentRef = useRef<string[]>([]);
  /** One token per read, so a late read does not clear a newer one's mark. */
  const inFlightRef = useRef(new Map<string, { revision: number }>());
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    setContents((current) => withSavedDrafts(current, { dirtyPaths, editorDrafts }));
  }, [dirtyPaths, editorDrafts]);

  // Trim when the tabs change and after each read lands: a read of a tab left
  // before it finished must not stay past the budget until the next switch.
  useEffect(() => {
    const open = new Set(openTabs);
    const recent = activeTabPath
      ? markTabRecent(recentRef.current, activeTabPath)
      : recentRef.current;
    recentRef.current = recent.filter((path) => open.has(path));
    setContents((current) =>
      trimTabContents(current, {
        openTabs,
        needed: tabsNeedingContent({ activeTabPath, dirtyPaths }),
        recent: recentRef.current,
        budgetChars: TAB_CONTENT_CACHE_CHARS,
      }),
    );
  }, [activeTabPath, contents, dirtyPaths, openTabs]);

  // A key, so a new dirty list with the same paths does not read again.
  const neededKey = tabsNeedingContent({ activeTabPath, dirtyPaths }).join("\0");

  useEffect(() => {
    const needed = neededKey
      .split("\0")
      .filter(
        (path) =>
          path &&
          !unresolvedImportPaths.has(path) &&
          !isImportWalkPlaceholderPath(path) &&
          !isImportQueueSlotPath(path),
      );
    const inFlight = new Set<string>();
    for (const [path, read] of inFlightRef.current) {
      if (read.revision >= treeRevision) inFlight.add(path);
    }
    for (const path of tabContentsToLoad(contents, needed, treeRevision, inFlight)) {
      const read = { revision: treeRevision };
      inFlightRef.current.set(path, read);
      const alreadyShown = contents[path]?.state === "loaded";
      void readTabContent(fs, vaultId, path, treeRevision, alreadyShown).then((content) => {
        if (inFlightRef.current.get(path) === read) inFlightRef.current.delete(path);
        if (disposedRef.current || !openTabsRef.current.includes(path)) return;
        setContents((current) => withTabContent(current, path, content));
        if (content.state === "failed") onReadFailedRef.current();
      });
    }
  }, [contents, fs, neededKey, treeRevision, unresolvedImportPaths, vaultId]);

  /** The editor's copy after a save wrote `text`. */
  const storeSavedText = useCallback((path: string, text: string) => {
    setContents((current) => {
      const previous = current[path];
      if (previous?.state === "loaded" && previous.text === text) return current;
      const revision = Math.max(previous?.revision ?? 0, revisionRef.current);
      return { ...current, [path]: { state: "loaded", text, revision } };
    });
  }, []);

  const contentOf = useCallback((path: string) => contentsRef.current[path], []);

  return { contents, contentOf, storeSavedText };
}
