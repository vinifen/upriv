import {
  isRpcError,
  imageDataUrlFromBase64,
  isInternalVaultPath,
  parseFileTreeNode,
  vaultFileLanguageFromPath,
  VAULT_ERROR_CODES,
  type VaultFileContent,
  type VaultFileLanguage,
} from "../../domain";
import type {
  FolderRemoval,
  VaultBinaryByteSource,
  VaultFileSystemService,
} from "./VaultFileSystemService";

/** Keep in sync with `upriv-core` `VAULT_FS_MAX_INLINE_BYTES` (per-chunk RPC cap). */
export const VAULT_FS_INLINE_CHUNK_BYTES = 4 * 1024 * 1024;
/** Editor preview stops here. Larger files stay on the ranged-read path and are not opened. */
export const VAULT_FS_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
/** A whole number of 3-byte groups, so the base64 of consecutive reads joins into one. */
const VAULT_FS_JOINABLE_CHUNK_BYTES =
  VAULT_FS_INLINE_CHUNK_BYTES - (VAULT_FS_INLINE_CHUNK_BYTES % 3);

export class FilePreviewTooLargeError extends Error {
  constructor() {
    super("preview_too_large");
    this.name = "FilePreviewTooLargeError";
  }
}

export interface LiveVaultFileSystemRpc {
  list(id: string): Promise<{ tree: unknown; revision: number }>;
  revision(id: string): Promise<number>;
  previewFits(id: string, path: string): Promise<{ fits: boolean }>;
  read(id: string, path: string): Promise<{ contentB64: string }>;
  readRange(id: string, path: string, offset: number, len: number): Promise<{ contentB64: string }>;
  write(id: string, path: string, contentB64: string): Promise<number>;
  writeRange(id: string, path: string, offset: number, contentB64: string): Promise<number>;
  importOsFile(
    id: string,
    parentPath: string,
    name: string,
    osPath: string,
  ): Promise<{ path: string; revision: number }>;
  truncate(id: string, path: string, size: number): Promise<number>;
  createFile(
    id: string,
    parentPath: string,
    name: string,
  ): Promise<{ path: string; revision: number }>;
  createFolder(
    id: string,
    parentPath: string,
    name: string,
  ): Promise<{ path: string; revision: number }>;
  ensureFolder(
    id: string,
    parentPath: string,
    name: string,
  ): Promise<{ path: string; revision: number }>;
  delete(id: string, path: string): Promise<number>;
  rename(id: string, path: string, newName: string): Promise<{ path: string; revision: number }>;
  move(
    id: string,
    fromPath: string,
    toFolderPath: string,
  ): Promise<{ path: string; revision: number }>;
  /** Absolute OS path on the live mount. `osPath` is null when there is no OS folder. */
  osPath(id: string, path: string): Promise<{ osPath: string | null }>;
  plainSend(id: string, paths: string[]): Promise<{ files: number }>;
  plainUnsend(id: string, paths: string[]): Promise<FolderRemoval>;
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function b64ByteLength(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - padding;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function dataUrlPayload(content: string): string | null {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(content.trim());
  return match?.[1] ?? null;
}

function bytesForWrite(path: string, content: string): Uint8Array {
  const fromDataUrl = dataUrlPayload(content);
  if (fromDataUrl) return b64ToBytes(fromDataUrl);
  if (vaultFileLanguageFromPath(path) === "image") return b64ToBytes(content);
  return new TextEncoder().encode(content);
}

function textFromBytes(path: string, bytes: Uint8Array): VaultFileContent {
  // Keep a leading BOM. fatal refuses bytes that are not UTF-8 instead of writing U+FFFD later.
  const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  return { language: vaultFileLanguageFromPath(path), content };
}

function pathKindFlags(path: string): { editable: boolean; viewable: boolean; image: boolean } {
  if (isInternalVaultPath(path)) {
    return { editable: false, viewable: false, image: false };
  }
  const language = vaultFileLanguageFromPath(path);
  return {
    editable: language !== "binary" && language !== "image",
    viewable: language !== "binary",
    image: language === "image",
  };
}

async function readAllBytes(
  rpc: LiveVaultFileSystemRpc,
  id: string,
  path: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const read = await rpc.readRange(id, path, offset, VAULT_FS_INLINE_CHUNK_BYTES);
    const bytes = b64ToBytes(read.contentB64);
    if (bytes.byteLength === 0) break;
    if (maxBytes != null && offset + bytes.byteLength > maxBytes) {
      throw new FilePreviewTooLargeError();
    }
    chunks.push(bytes);
    offset += bytes.byteLength;
    if (bytes.byteLength < VAULT_FS_INLINE_CHUNK_BYTES) break;
  }
  return concatBytes(chunks);
}

/**
 * A file as base64, joined from what core sent. An image goes to the viewer in
 * this form, so its bytes are not decoded in JS only to be encoded again.
 */
async function readAllB64(
  rpc: LiveVaultFileSystemRpc,
  id: string,
  path: string,
  maxBytes: number,
): Promise<string> {
  const chunks: string[] = [];
  let offset = 0;
  for (;;) {
    const { contentB64 } = await rpc.readRange(id, path, offset, VAULT_FS_JOINABLE_CHUNK_BYTES);
    const byteLength = b64ByteLength(contentB64);
    if (byteLength === 0) break;
    if (offset + byteLength > maxBytes) throw new FilePreviewTooLargeError();
    chunks.push(contentB64);
    offset += byteLength;
    if (byteLength < VAULT_FS_JOINABLE_CHUNK_BYTES) break;
  }
  return chunks.join("");
}

async function writeAllBytes(
  rpc: LiveVaultFileSystemRpc,
  id: string,
  path: string,
  bytes: Uint8Array,
): Promise<number> {
  return writeAllBytesFromSource(rpc, id, path, {
    size: bytes.byteLength,
    slice: async (start, end) => bytes.subarray(start, end),
  });
}

async function writeAllBytesFromSource(
  rpc: LiveVaultFileSystemRpc,
  id: string,
  path: string,
  source: VaultBinaryByteSource,
): Promise<number> {
  if (source.size === 0) {
    return rpc.write(id, path, "");
  }
  if (source.size < 0) {
    let offset = 0;
    for (;;) {
      const bytes = await source.slice(offset, offset + VAULT_FS_INLINE_CHUNK_BYTES);
      if (bytes.byteLength === 0) break;
      if (offset === 0 && bytes.byteLength < VAULT_FS_INLINE_CHUNK_BYTES) {
        return rpc.write(id, path, bytesToB64(bytes));
      }
      await rpc.writeRange(id, path, offset, bytesToB64(bytes));
      offset += bytes.byteLength;
      if (bytes.byteLength < VAULT_FS_INLINE_CHUNK_BYTES) break;
    }
    return offset === 0 ? rpc.write(id, path, "") : rpc.truncate(id, path, offset);
  }
  if (source.size <= VAULT_FS_INLINE_CHUNK_BYTES) {
    const bytes = await source.slice(0, source.size);
    return rpc.write(id, path, bytesToB64(bytes));
  }
  let offset = 0;
  while (offset < source.size) {
    const end = Math.min(offset + VAULT_FS_INLINE_CHUNK_BYTES, source.size);
    const bytes = await source.slice(offset, end);
    await rpc.writeRange(id, path, offset, bytesToB64(bytes));
    offset = end;
  }
  return rpc.truncate(id, path, source.size);
}

/** Shared live adapter — desktop daemon and native FFI pass their `rpc*` fns. */
export function createLiveVaultFileSystemService(
  rpc: LiveVaultFileSystemRpc,
): VaultFileSystemService {
  return {
    resetSession() {
      /* Session lives in upriv-core RAM; close/purge is vault_close. */
    },

    async getTreeRevision(vaultId) {
      return rpc.revision(vaultId);
    },

    async getFileTree(vaultId) {
      const listed = await rpc.list(vaultId);
      return parseFileTreeNode(listed.tree);
    },

    async getFileContent(vaultId, path) {
      // Hidden from the editor, but this is the persisted open-tab snapshot.
      if (!isInternalVaultPath(path) && !pathKindFlags(path).viewable) {
        return { language: vaultFileLanguageFromPath(path), content: "" };
      }
      try {
        if (pathKindFlags(path).image) {
          const b64 = await readAllB64(rpc, vaultId, path, VAULT_FS_PREVIEW_MAX_BYTES);
          return { language: "image", content: imageDataUrlFromBase64(b64, path) };
        }
        const maxBytes = isInternalVaultPath(path) ? undefined : VAULT_FS_PREVIEW_MAX_BYTES;
        return textFromBytes(path, await readAllBytes(rpc, vaultId, path, maxBytes));
      } catch (error) {
        if (isRpcError(error) && error.code === VAULT_ERROR_CODES.PATH_NOT_FOUND) {
          return null;
        }
        throw error;
      }
    },

    async previewFits(vaultId, path) {
      const answer = await rpc.previewFits(vaultId, path);
      return answer.fits;
    },

    isFileEditable(_vaultId, path) {
      return pathKindFlags(path).editable;
    },

    isFileViewable(_vaultId, path) {
      return pathKindFlags(path).viewable;
    },

    isFileImage(_vaultId, path) {
      return pathKindFlags(path).image;
    },

    async setFileContent(vaultId, path, content) {
      return writeAllBytes(rpc, vaultId, path, bytesForWrite(path, content));
    },

    async createFile(vaultId, parentPath, baseName) {
      try {
        const created = await rpc.createFile(vaultId, parentPath, baseName);
        return created.path;
      } catch {
        return null;
      }
    },

    async importFile(vaultId, parentPath, fileName, content) {
      const created = await rpc.createFile(vaultId, parentPath, fileName);
      try {
        await writeAllBytes(rpc, vaultId, created.path, bytesForWrite(created.path, content));
        return created.path;
      } catch (error) {
        await rpc.delete(vaultId, created.path).catch(() => undefined);
        throw error;
      }
    },

    async importFileFromBytes(vaultId, parentPath, fileName, source) {
      const created = await rpc.createFile(vaultId, parentPath, fileName);
      try {
        await writeAllBytesFromSource(rpc, vaultId, created.path, source);
        return created.path;
      } catch (error) {
        await rpc.delete(vaultId, created.path).catch(() => undefined);
        throw error;
      }
    },

    async importFileFromOsPath(vaultId, parentPath, fileName, osPath) {
      const created = await rpc.importOsFile(vaultId, parentPath, fileName, osPath);
      return created.path;
    },

    async createFolder(vaultId, parentPath, baseName) {
      try {
        const created = await rpc.createFolder(vaultId, parentPath, baseName);
        return created.path;
      } catch {
        return null;
      }
    },

    async ensureFolder(vaultId, parentPath, folderName) {
      const created = await rpc.ensureFolder(vaultId, parentPath, folderName);
      return created.path;
    },

    async renamePath(vaultId, path, newName) {
      try {
        const renamed = await rpc.rename(vaultId, path, newName);
        return renamed.path;
      } catch {
        return null;
      }
    },

    async deletePath(vaultId, path) {
      try {
        await rpc.delete(vaultId, path);
        return true;
      } catch {
        return false;
      }
    },

    async movePath(vaultId, fromPath, toFolderPath) {
      try {
        const moved = await rpc.move(vaultId, fromPath, toFolderPath);
        return moved.path;
      } catch {
        return null;
      }
    },

    async osPath(vaultId, path) {
      const resolved = await rpc.osPath(vaultId, path);
      return resolved.osPath;
    },

    async sendToFolder(vaultId, paths) {
      const sent = await rpc.plainSend(vaultId, paths);
      return sent.files;
    },

    removeFromFolder: (vaultId, paths) => rpc.plainUnsend(vaultId, paths),

    languageFromPath(path): VaultFileLanguage {
      return vaultFileLanguageFromPath(path);
    },
  };
}
