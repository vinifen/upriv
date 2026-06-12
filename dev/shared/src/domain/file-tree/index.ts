export type {
  FileTreeNode,
  FileTreeNodeType,
  VaultFileContent,
  VaultFileLanguage,
} from "./types";
export { vaultFileLanguageFromPath } from "./language";
export { validateFileName, type FileNameValidationCode } from "./fileNameValidation";
export { joinPath, fileBaseName, findNode, isFolderPath } from "./treeUtils";
export {
  getParentPath,
  siblingNames,
  isDescendantPath,
  uniqueName,
  uniqueFolderName,
  addChild,
  removeNode,
  renameNode,
  moveNode,
  collectFilePaths,
  remapContentPaths,
  removeContentPaths,
} from "./treeOps";
export {
  TREE_SPLIT_DEFAULT_PERCENT,
  TREE_SPLIT_MIN_PERCENT,
  TREE_SPLIT_MAX_PERCENT,
  TREE_SPLIT_MIN_PX,
  clampTreeSplitPercent,
  percentFromPointer,
} from "./treeSplit";
export { resolveImportDestination, foldersToExpandOnImport } from "./importPaths";
