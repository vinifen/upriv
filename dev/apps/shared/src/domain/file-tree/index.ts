export type {
  FileProblem,
  FileTreeNode,
  FileTreeNodeType,
  VaultFileContent,
  VaultFileLanguage,
} from "./types";
export { parseFileTreeNode } from "./parse";
export { treeFolderPresence, type FolderPresence } from "./folderPresence";
export {
  FILE_PROBLEM_BODY_I18N_KEYS,
  FILE_PROBLEM_MARK_I18N_KEYS,
  treeFileProblems,
  editorFileProblem,
  treeMarkBehindRead,
  fileProblemMark,
  fileProblemRows,
  fileProblemOfError,
  type FileProblemMark,
  type TreeFileProblems,
} from "./fileProblems";
export {
  HELD_FILE_STANDING_I18N_KEYS,
  heldFileStanding,
  heldSummary,
  parseHeldItems,
  type HeldFile,
  type HeldFileItem,
  type HeldFileStanding,
  type HeldItem,
  type HeldSummary,
} from "./heldFiles";
export { searchTreeRows } from "./searchTree";
export { vaultFileLanguageFromPath, imageMimeFromPath, imageDataUrlFromBase64 } from "./language";
export {
  validateFileName,
  liveFileNameError,
  persistLogicalFileName,
  acceptedLogicalFileName,
  sanitizeLogicalFileName,
  LOGICAL_FILE_NAME_MAX_LENGTH,
} from "./fileNameValidation";
export type { FileNameValidationResult } from "./fileNameValidation";
export { renameBasenameSelection } from "./renameSelection";
export { fileNameErrorI18nKey, type FileNameErrorCode } from "./errorMessages";
export {
  joinPath,
  fileBaseName,
  findNode,
  visibleTreeRows,
  type VisibleTreeRow,
} from "./treeUtils";
export {
  getParentPath,
  ancestorFolderPaths,
  siblingNames,
  isDescendantPath,
  uniqueName,
  uniqueFolderName,
  addChild,
  removeNode,
  renameNode,
  moveNode,
  collectFilePaths,
  remapLogicalPath,
  remapContentPaths,
  removeContentPaths,
} from "./treeOps";
export {
  TREE_SPLIT_DEFAULT_PERCENT,
  TREE_SPLIT_MIN_PERCENT,
  TREE_SPLIT_MAX_PERCENT,
  clampCanonicalTreeSplitPercent,
  displayTreeSplitPercent,
  isTreeSplitDragCollapsed,
  percentFromDelta,
  persistableTreeSplitPercent,
} from "./treeSplit";
export type { TreeSplitAxis } from "./treeSplit";
export {
  resolveImportDestination,
  foldersToExpandOnImport,
  foldersToExpandForImportBatch,
  importPathSegments,
} from "./importPaths";
export {
  IMPORT_WALK_SLOT_COUNT,
  IMPORT_WALK_SLOT_PREFIX,
  isImportWalkPlaceholderName,
  isImportWalkPlaceholderPath,
  walkPlaceholderEntries,
  IMPORT_EXPLORER_SKELETON_FILES,
  IMPORT_QUEUE_SLOT_NAME,
  isImportQueueSlotPath,
  pendingEntriesForExplorer,
  plannedImportPathMap,
  pendingEntriesFromRelativePaths,
  replaceSessionPending,
  dropSessionPending,
  dropPendingUnder,
  ensureNodeAtPath,
  mergePendingIntoTree,
  attachImportedPath,
  dropResolvedPending,
  upsertActiveImportWrite,
  dropActiveImportWritesForSession,
  dropActiveImportWritePath,
  dropActiveImportWritesUnder,
  activeImportWriteForPath,
  rememberLandedImportPaths,
  releaseLandedImportPaths,
  type PendingImportEntry,
  type ActiveImportWrite,
} from "./pendingImport";
export {
  importOutcomeToast,
  formatImportOutcomeToast,
  type ImportOutcomeToast,
} from "./importToast";
