import type { CreateVaultInput, VaultListItem } from "@upriv/shared";

export interface ContentImportFile {
  logicalPath: string;
  uri: string;
}

/** Folder or single file held in memory until the creating job streams it. */
export interface ContentImportTree {
  directoryUri: string;
  folderName: string;
  directories: string[];
  files: ContentImportFile[];
}

export interface ContentTreeImportIo {
  createVault(input: CreateVaultInput): Promise<VaultListItem>;
  openSession(id: string, password: string): Promise<void>;
  addDirectory(id: string, logicalPath: string): Promise<void>;
  addFile(id: string, logicalPath: string, uri: string): Promise<void>;
  close(id: string, password: string): Promise<void>;
  abort(id: string): Promise<void>;
}

/**
 * Path of one child inside the picked folder, with the folder name removed.
 * `null` when the entry is not strictly inside that folder.
 */
export function relativeUnderPickedFolder(relative: string, folderName: string): string | null {
  const prefix = `${folderName}/`;
  if (!relative.startsWith(prefix)) return null;
  const rest = relative.slice(prefix.length);
  if (!rest || rest.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  return rest;
}

function byDirectoryDepth(a: string, b: string): number {
  const depth = a.split("/").length - b.split("/").length;
  if (depth !== 0) return depth;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Children of the picked folder, at the vault root. The folder name is not a prefix. */
export function contentTreeFromFolderPick(picked: {
  files: { relativePath: string; uri: string }[];
  directories?: string[];
  folderName?: string;
  releaseSafTree?: string;
}): ContentImportTree {
  const directoryUri = picked.releaseSafTree?.trim() ?? "";
  if (!directoryUri) throw new Error("import folder is unavailable");
  const folderName = picked.folderName?.trim() || "folder";
  const directories: string[] = [];
  for (const directory of picked.directories ?? []) {
    const logical = relativeUnderPickedFolder(directory, folderName);
    if (!logical) throw new Error("import folder entry is outside the chosen folder");
    directories.push(logical);
  }
  directories.sort(byDirectoryDepth);
  const files: ContentImportFile[] = [];
  for (const file of picked.files) {
    const logical = relativeUnderPickedFolder(file.relativePath, folderName);
    if (!logical) throw new Error("import folder entry is outside the chosen folder");
    if (!file.uri.trim()) throw new Error("import folder entry is unavailable");
    files.push({ logicalPath: logical, uri: file.uri });
  }
  assertImportTreeNames(directories, files);
  return { directoryUri, folderName, directories, files };
}

/** One document. `path` is the wizard key; `uri` is what Android can open. */
export function contentTreeFromPickedFile(picked: {
  path: string;
  uri: string;
  fileName: string;
}): ContentImportTree {
  const directoryUri = picked.path.trim();
  const uri = picked.uri.trim();
  const logicalPath = picked.fileName.trim();
  if (!directoryUri || !uri || !logicalPath) throw new Error("import file is unavailable");
  const files = [{ logicalPath, uri }];
  assertImportTreeNames([], files);
  return { directoryUri, folderName: logicalPath, directories: [], files };
}

const RESERVED_SEED_PATH = "upriv-seed.txt";
const RESERVED_WORKSPACE_FILE = ".upriv-workspace.json";

function fileNameOf(logical: string): string {
  const slash = logical.lastIndexOf("/");
  return slash === -1 ? logical : logical.slice(slash + 1);
}

/** Same names `upriv-core` refuses while streaming an import. */
function reservedImportLogical(logical: string): boolean {
  return logical === RESERVED_SEED_PATH || fileNameOf(logical) === RESERVED_WORKSPACE_FILE;
}

/**
 * Sanitized names can collide. A later write would replace the earlier file
 * and the vault would still look complete.
 */
function assertImportTreeNames(
  directories: readonly string[],
  files: readonly ContentImportFile[],
): void {
  const directoryNames = new Set<string>();
  for (const directory of directories) {
    if (reservedImportLogical(directory)) {
      throw new Error("import folder entry is reserved");
    }
    if (directoryNames.has(directory)) {
      throw new Error("import folder has two entries with the same name");
    }
    directoryNames.add(directory);
  }
  const fileNames = new Set<string>();
  for (const file of files) {
    const logical = file.logicalPath;
    if (reservedImportLogical(logical)) {
      throw new Error("import folder entry is reserved");
    }
    if (fileNames.has(logical) || directoryNames.has(logical)) {
      throw new Error("import folder has two entries with the same name");
    }
    fileNames.add(logical);
  }
  for (const directory of directories) {
    for (const file of fileNames) {
      if (directory.startsWith(`${file}/`)) {
        throw new Error("import folder has two entries with the same name");
      }
    }
  }
}

type ContentTreeSlot = {
  /** Listing the wizard is showing. `null` after that pick was cancelled or handed to a job. */
  wizard: ContentImportTree | null;
  jobs: Set<ContentImportTree>;
};

/** Listings. The permission stays while the wizard or a creating job still needs it. */
export function createContentTreeRegistry() {
  const entries = new Map<string, ContentTreeSlot>();

  const dropIfIdle = (key: string, slot: ContentTreeSlot): boolean => {
    if (slot.wizard || slot.jobs.size > 0) return false;
    entries.delete(key);
    return true;
  };

  return {
    remember(tree: ContentImportTree): void {
      const current = entries.get(tree.directoryUri);
      if (current) {
        current.wizard = tree;
        return;
      }
      entries.set(tree.directoryUri, { wizard: tree, jobs: new Set() });
    },
    has(path: string): boolean {
      const slot = entries.get(path.trim());
      return Boolean(slot && (slot.wizard || slot.jobs.size > 0));
    },
    /** Hand the current listing to one creating job and clear the wizard's claim. */
    takeForJob(path: string): ContentImportTree | undefined {
      const key = path.trim();
      const slot = entries.get(key);
      if (!slot?.wizard) return undefined;
      const tree = slot.wizard;
      slot.jobs.add(tree);
      slot.wizard = null;
      return tree;
    },
    /** `true` when the folder permission can be dropped. */
    releaseWizard(path: string): boolean {
      const key = path.trim();
      const slot = entries.get(key);
      if (!slot?.wizard) return false;
      slot.wizard = null;
      return dropIfIdle(key, slot);
    },
    releaseJob(tree: ContentImportTree): boolean {
      const key = tree.directoryUri.trim();
      const slot = entries.get(key);
      if (!slot?.jobs.delete(tree)) return false;
      return dropIfIdle(key, slot);
    },
  };
}

/**
 * Create the vault, stream the folder in, then close it.
 * A failure deletes the new vault instead of leaving it open or half-filled.
 */
export async function importContentTree(
  input: CreateVaultInput,
  tree: ContentImportTree,
  io: ContentTreeImportIo,
): Promise<VaultListItem> {
  const created = await io.createVault({
    password: input.password,
    unlockPreset: input.unlockPreset,
    settings: input.settings,
  });
  try {
    await io.openSession(created.id, input.password);
    for (const directory of tree.directories) {
      await io.addDirectory(created.id, directory);
    }
    for (const file of tree.files) {
      await io.addFile(created.id, file.logicalPath, file.uri);
    }
    await io.close(created.id, input.password);
    return created;
  } catch (error) {
    await io.abort(created.id);
    throw error;
  }
}
