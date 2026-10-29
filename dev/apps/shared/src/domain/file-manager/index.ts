export type {
  FileContextMenuState,
  FileDeleteTarget,
  MarkdownViewMode,
  PerFileWorkspaceState,
  UnsavedPromptAction,
  VaultWorkspaceState,
} from "./workspaceTypes";
export {
  createDefaultWorkspaceState,
  fileEditorWordWrap,
  fileMarkdownOutlineOpen,
  fileMarkdownView,
  fileSearchQuery,
  hasUnsavedWorkspaceChanges,
  isPathDirty,
  markdownViewMode,
  sessionPathKind,
} from "./workspaceTypes";
export type { TextMatch } from "./fileSearch";
export { findTextMatches, stepMatchIndex } from "./fileSearch";
export type { OutlineScroll } from "./outlineScroll";
export { activeOutlineIndex } from "./outlineScroll";
export type { SessionPathKind } from "./workspaceTypes";
export type { VaultWorkspaceAction } from "./workspaceReducer";
export { vaultWorkspaceReducer, resolveUnsavedPrompt, reorderOpenTabs } from "./workspaceReducer";
export {
  MAX_DIRTY_DRAFT_SAVE_PASSES,
  saveDirtyVaultDrafts,
  withSavedDraftDiskContents,
} from "./saveDirtyDrafts";
export {
  unsavedPromptBodyKey,
  unsavedPromptConfirmsAllFiles,
  unsavedPromptIsImport,
} from "./unsavedPrompt";
export {
  fileTabMenuAction,
  fileTabMenuItems,
  type FileTabMenuItem,
  type FileTabMenuItemId,
} from "./tabMenu";
export type {
  FileManagerAction,
  FileManagerDismissIntent,
  FileManagerEntry,
  FileManagerState,
  FileManagerSurface,
} from "./dockReducer";
export {
  createEmptyFileManagerState,
  closeIntentAfterUnsavedResolved,
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  vaultCloseBlockingPrompt,
  fileManagerReducer,
} from "./dockReducer";
export {
  importLogicalFiles,
  type ImportLogicalFile,
  type ImportLogicalResult,
} from "./importLogicalFiles";
export { importFileSlots } from "./importSlots";
export { yieldToPaint } from "./yieldToPaint";
export { markdownLinkHref } from "./markdownLink";
export { breadcrumbShrink, pathBreadcrumbs } from "./pathBreadcrumbs";
export {
  MARKDOWN_PREVIEW_MAX_CHARS,
  markdownOutline,
  parseMarkdownDocument,
  toggleMarkdownTask,
} from "./markdownDocument";
export type {
  MarkdownAlign,
  MarkdownBlock,
  MarkdownFootnote,
  MarkdownInline,
  MarkdownListItem,
  MarkdownOutlineEntry,
  MarkdownOutlineModel,
  MarkdownPreviewModel,
} from "./markdownDocument";
export {
  UPRIV_WORKSPACE_FILE_NAME,
  UPRIV_WORKSPACE_PATH,
  WORKSPACE_SNAPSHOT_FORMAT_VERSION,
  isInternalVaultFileName,
  isInternalVaultPath,
  omitInternalVaultNodes,
  parseWorkspaceSnapshot,
  persistWorkspaceSnapshot,
  serializedLayoutSnapshot,
  serializeWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  workspaceSnapshotFromState,
  snapshotsEqual,
  workspaceSnapshotToHydrate,
  type WorkspaceSnapshot,
} from "./workspaceSnapshot";
