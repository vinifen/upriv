import type { VaultWorkspaceState } from "./workspaceTypes";

/**
 * What the editor holds for one open tab, read at tree revision `revision`.
 * `text` is the file's text, or a data URL for an image.
 */
export type TabContent =
  | { state: "loaded"; text: string; revision: number }
  | { state: "failed"; revision: number }
  /** Over the preview cap or free RAM. Kept until the tab closes, so it is not read again. */
  | { state: "too_large"; revision: number };

export type TabContents = Readonly<Record<string, TabContent>>;

/**
 * Text kept for open tabs that are neither on screen nor unsaved, counted in
 * UTF-16 code units, newest first. Switching back to one of them is instant;
 * past this the oldest is dropped and read again when it is shown.
 */
export const TAB_CONTENT_CACHE_CHARS = 16 * 1024 * 1024;

/**
 * Tabs whose content must be in RAM: the one on screen, and every unsaved one
 * (a save checks its file was read).
 */
export function tabsNeedingContent(
  workspace: Pick<VaultWorkspaceState, "activeTabPath" | "dirtyPaths">,
): string[] {
  const { activeTabPath, dirtyPaths } = workspace;
  if (!activeTabPath || dirtyPaths.includes(activeTabPath)) return dirtyPaths.slice();
  return [activeTabPath, ...dirtyPaths];
}

/**
 * Needed tabs to read now: never read, or read before `revision` (the tree
 * changed since). A tab over the preview cap is not read again.
 */
export function tabContentsToLoad(
  contents: TabContents,
  needed: readonly string[],
  revision: number,
  inFlight: ReadonlySet<string>,
): string[] {
  return needed.filter((path) => {
    if (inFlight.has(path)) return false;
    const current = contents[path];
    if (!current) return true;
    return current.state !== "too_large" && current.revision < revision;
  });
}

/** Store a read unless a newer read of that tab already landed. */
export function withTabContent(
  contents: TabContents,
  path: string,
  content: TabContent,
): TabContents {
  const current = contents[path];
  if (current && current.revision > content.revision) return contents;
  return { ...contents, [path]: content };
}

/**
 * Drop tabs that closed, then keep the other unneeded tabs while their text
 * fits in `budgetChars`, newest first (`recent`, most recent first).
 */
export function trimTabContents(
  contents: TabContents,
  options: {
    openTabs: readonly string[];
    needed: readonly string[];
    recent: readonly string[];
    budgetChars: number;
  },
): TabContents {
  const open = new Set(options.openTabs);
  const keep = new Set(options.needed.filter((path) => open.has(path)));
  let used = 0;
  for (const path of options.recent) {
    if (keep.has(path) || !open.has(path)) continue;
    const content = contents[path];
    if (!content) continue;
    const size = content.state === "loaded" ? content.text.length : 0;
    if (used + size > options.budgetChars) continue;
    used += size;
    keep.add(path);
  }
  const paths = Object.keys(contents);
  if (paths.every((path) => keep.has(path))) return contents;
  const next: Record<string, TabContent> = {};
  for (const path of paths) {
    if (keep.has(path)) next[path] = contents[path];
  }
  return next;
}

/** `path` first, then the rest of `recent` without it. */
export function markTabRecent(recent: readonly string[], path: string): string[] {
  if (recent[0] === path) return recent.slice();
  return [path, ...recent.filter((other) => other !== path)];
}

/**
 * A clean draft is the text just stored (a save from this file manager or from
 * a vault close), so a tab read before that save must hold it before a later
 * discard shows the editor. A tab not in RAM is read from the vault, which
 * already has it.
 */
export function withSavedDrafts(
  contents: TabContents,
  workspace: Pick<VaultWorkspaceState, "dirtyPaths" | "editorDrafts">,
): TabContents {
  const dirty = new Set(workspace.dirtyPaths);
  let next: Record<string, TabContent> | null = null;
  for (const [path, draft] of Object.entries(workspace.editorDrafts)) {
    if (dirty.has(path)) continue;
    const current = contents[path];
    if (current?.state !== "loaded" || current.text === draft) continue;
    next ??= { ...contents };
    next[path] = { ...current, text: draft };
  }
  return next ?? contents;
}
