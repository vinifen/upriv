import { describe, expect, it, vi } from "vitest";
import { RpcError, VAULT_ERROR_CODES } from "../../../domain";
import {
  createLiveVaultFileSystemService,
  FilePreviewTooLargeError,
  VAULT_FS_INLINE_CHUNK_BYTES,
  VAULT_FS_PREVIEW_MAX_BYTES,
  type LiveVaultFileSystemRpc,
} from "../createLiveVaultFileSystemService";

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function rpcStub(overrides: Partial<LiveVaultFileSystemRpc> = {}): LiveVaultFileSystemRpc {
  return {
    list: async () => ({ tree: { name: "", type: "folder", children: [] }, revision: 1 }),
    revision: async () => 1,
    read: async () => ({ contentB64: "" }),
    readRange: async () => ({ contentB64: "" }),
    write: async () => 1,
    writeRange: async () => 1,
    importOsFile: async (_id, _parent, name) => ({ path: `/${name}`, revision: 1 }),
    truncate: async () => 1,
    createFile: async (_id, _parent, name) => ({ path: `/${name}`, revision: 1 }),
    createFolder: async (_id, _parent, name) => ({ path: `/${name}`, revision: 1 }),
    ensureFolder: async (_id, _parent, name) => ({ path: `/${name}`, revision: 1 }),
    delete: async () => 1,
    rename: async () => ({ path: "/renamed", revision: 1 }),
    move: async () => ({ path: "/moved", revision: 1 }),
    osPath: async () => ({ osPath: "/tmp/mount" }),
    ...overrides,
  };
}

describe("createLiveVaultFileSystemService", () => {
  it("reads files in range chunks instead of a single inline payload", async () => {
    const payload = new TextEncoder().encode("hello-range");
    const readRange = vi.fn(async (_id: string, _path: string, offset: number, len: number) => {
      const slice = payload.subarray(offset, offset + len);
      return { contentB64: bytesToB64(slice) };
    });
    const fs = createLiveVaultFileSystemService(rpcStub({ readRange }));
    const file = await fs.getFileContent("v", "/note.txt");
    expect(file?.content).toBe("hello-range");
    expect(readRange).toHaveBeenCalled();
  });

  it("writes oversized files with range + truncate, not a single vault_fs_write", async () => {
    const offsets: number[] = [];
    const write = vi.fn(async () => 1);
    const writeRange = vi.fn(
      async (_id: string, _path: string, offset: number, _contentB64: string) => {
        offsets.push(offset);
        return 1;
      },
    );
    const truncate = vi.fn(async () => 2);
    const fs = createLiveVaultFileSystemService(rpcStub({ write, writeRange, truncate }));
    const oversized = "x".repeat(VAULT_FS_INLINE_CHUNK_BYTES + 8);
    await fs.setFileContent("v", "/big.txt", oversized);
    expect(write).not.toHaveBeenCalled();
    expect(writeRange).toHaveBeenCalled();
    expect(truncate).toHaveBeenCalledWith("v", "/big.txt", oversized.length);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(VAULT_FS_INLINE_CHUNK_BYTES);
  });

  it("deletes the created node when import write fails", async () => {
    const created = { path: "/photo.jpg", revision: 1 };
    const createFile = vi.fn(async () => created);
    const deleteFn = vi.fn(async () => 2);
    const fs = createLiveVaultFileSystemService(
      rpcStub({
        createFile,
        delete: deleteFn,
        write: async () => {
          throw new RpcError(VAULT_ERROR_CODES.FILE_TOO_LARGE, "too large");
        },
      }),
    );
    await expect(fs.importFile("v", "/", "photo.jpg", "data")).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.FILE_TOO_LARGE,
    });
    expect(deleteFn).toHaveBeenCalledWith("v", "/photo.jpg");
  });

  it("returns null only when the path is missing, and rethrows other read errors", async () => {
    const missing = createLiveVaultFileSystemService(
      rpcStub({
        readRange: async () => {
          throw new RpcError(VAULT_ERROR_CODES.PATH_NOT_FOUND, "missing");
        },
      }),
    );
    await expect(missing.getFileContent("v", "/gone.txt")).resolves.toBeNull();

    const failed = createLiveVaultFileSystemService(
      rpcStub({
        readRange: async () => {
          throw new RpcError(VAULT_ERROR_CODES.FILE_TOO_LARGE, "too large");
        },
      }),
    );
    await expect(failed.getFileContent("v", "/big.txt")).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.FILE_TOO_LARGE,
    });
  });

  it("reads the hidden workspace snapshot that stores open tabs", async () => {
    const raw = '{"format_version":1,"openTabs":["/a.md"]}\n';
    const readRange = vi.fn(async () => ({
      contentB64: bytesToB64(new TextEncoder().encode(raw)),
    }));
    const fs = createLiveVaultFileSystemService(rpcStub({ readRange }));
    const file = await fs.getFileContent("v", "/.upriv-workspace.json");
    expect(file?.content).toBe(raw);
    expect(readRange).toHaveBeenCalled();
  });

  it("does not load binary vault files into the editor buffer", async () => {
    const readRange = vi.fn(async () => ({ contentB64: "" }));
    const fs = createLiveVaultFileSystemService(rpcStub({ readRange }));
    const file = await fs.getFileContent("v", "/demo.mkv");
    expect(file).toEqual({ language: "binary", content: "" });
    expect(readRange).not.toHaveBeenCalled();
  });

  it("streams importFileFromBytes in range chunks", async () => {
    const offsets: number[] = [];
    const write = vi.fn(async () => 1);
    const writeRange = vi.fn(
      async (_id: string, _path: string, offset: number, _contentB64: string) => {
        offsets.push(offset);
        return 1;
      },
    );
    const truncate = vi.fn(async () => 2);
    const payload = new Uint8Array(VAULT_FS_INLINE_CHUNK_BYTES + 8);
    payload.fill(7);
    const fs = createLiveVaultFileSystemService(rpcStub({ write, writeRange, truncate }));
    await fs.importFileFromBytes("v", "/", "demo.mkv", {
      size: payload.byteLength,
      slice: async (start, end) => payload.subarray(start, end),
    });
    expect(write).not.toHaveBeenCalled();
    expect(writeRange).toHaveBeenCalled();
    expect(truncate).toHaveBeenCalledWith("v", "/demo.mkv", payload.byteLength);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(VAULT_FS_INLINE_CHUNK_BYTES);
  });

  it("streams an unknown-size source until a short read", async () => {
    const payload = new Uint8Array(VAULT_FS_INLINE_CHUNK_BYTES + 8);
    payload.fill(3);
    const write = vi.fn(async () => 1);
    const writeRange = vi.fn(async () => 1);
    const truncate = vi.fn(async () => 2);
    const fs = createLiveVaultFileSystemService(rpcStub({ write, writeRange, truncate }));
    await fs.importFileFromBytes("v", "/", "blob.bin", {
      size: -1,
      slice: async (start, end) => payload.subarray(start, Math.min(end, payload.byteLength)),
    });
    expect(write).not.toHaveBeenCalled();
    expect(writeRange).toHaveBeenCalled();
    expect(truncate).toHaveBeenCalledWith("v", "/blob.bin", payload.byteLength);
  });

  it("imports an OS path through a single importOsFile RPC", async () => {
    const importOsFile = vi.fn(async () => ({ path: "/pack.zip", revision: 4 }));
    const writeRange = vi.fn(async () => 1);
    const fs = createLiveVaultFileSystemService(rpcStub({ importOsFile, writeRange }));
    await expect(fs.importFileFromOsPath("v", "/", "pack.zip", "/tmp/pack.zip")).resolves.toBe(
      "/pack.zip",
    );
    expect(importOsFile).toHaveBeenCalledWith("v", "/", "pack.zip", "/tmp/pack.zip");
    expect(writeRange).not.toHaveBeenCalled();
  });

  it("stops a preview once the file is past the preview limit", async () => {
    const chunk = new Uint8Array(VAULT_FS_INLINE_CHUNK_BYTES);
    const readRange = vi.fn(async () => ({ contentB64: bytesToB64(chunk) }));
    const fs = createLiveVaultFileSystemService(rpcStub({ readRange }));
    await expect(fs.getFileContent("v", "/big.txt")).rejects.toBeInstanceOf(
      FilePreviewTooLargeError,
    );
    expect(readRange.mock.calls.length).toBe(
      Math.floor(VAULT_FS_PREVIEW_MAX_BYTES / VAULT_FS_INLINE_CHUNK_BYTES) + 1,
    );
  });

  it("refuses to decode text that is not UTF-8", async () => {
    const readRange = vi.fn(async () => ({ contentB64: bytesToB64(new Uint8Array([0xff])) }));
    const fs = createLiveVaultFileSystemService(rpcStub({ readRange }));
    await expect(fs.getFileContent("v", "/note.txt")).rejects.toThrow(TypeError);
  });

  it("forwards osPath to the live RPC", async () => {
    const osPath = vi.fn(async () => ({ osPath: "/mnt/Notes/a.txt" }));
    const fs = createLiveVaultFileSystemService(rpcStub({ osPath }));
    await expect(fs.osPath("v", "/a.txt")).resolves.toBe("/mnt/Notes/a.txt");
    expect(osPath).toHaveBeenCalledWith("v", "/a.txt");
  });
});
