export type { FileTreeNode, FileTreeNodeType, VaultFileContent, VaultFileLanguage } from "./types";
export {
  vaultFileLanguageFromPath,
  isVaultImportUnsupported,
  imageMimeFromPath,
  imageDataUrlFromBase64,
} from "./language";
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
export { joinPath, fileBaseName, findNode, isFolderPath } from "./treeUtils";
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
  TREE_SPLIT_MIN_PX,
  TREE_SPLIT_MIN_PX_COLUMN,
  clampCanonicalTreeSplitPercent,
  persistableTreeSplitPercent,
  displayTreeSplitPercent,
  percentFromPointer,
  percentFromDelta,
  treeSplitMinPx,
  treeSplitVisualMinPercent,
} from "./treeSplit";
export type { TreeSplitAxis } from "./treeSplit";
export {
  resolveImportDestination,
  foldersToExpandOnImport,
  importPathSegments,
} from "./importPaths";
export {
  importOutcomeToast,
  formatImportOutcomeToast,
  type ImportOutcomeToast,
} from "./importToast";
