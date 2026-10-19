import { describe, expect, it, vi } from "vitest";
import { DATA_FOLDER_EXPORT_ERROR_CODES, RpcError, isRpcError } from "@upriv/shared";

vi.mock("@/lib/rpc", () => ({
  rpcDataFolderExport: vi.fn(),
  rpcDataFolderExportStatus: vi.fn(),
  rpcDataFolderExportCancel: vi.fn(),
}));

vi.mock("../safVaultRoot", () => ({
  mountSafExport: vi.fn(),
  unmountSafExport: vi.fn(),
  safReleaseImportTree: vi.fn(),
}));

import { createNativeDataFolderService, type NativeDataFolderIo } from "../dataFolderService";

const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const OTHER = "content://com.android.externalstorage.documents/tree/primary%3AMusic";
const WRITTEN = { path: "/upriv-saf-export/upriv-2026-10-19-031500.zip", size: 4096 };

interface FakeIo extends NativeDataFolderIo {
  calls: string[];
  /** Answers for `exportProgress`, oldest first. Empty means no export runs. */
  progress: Array<{ bytesDone: number; bytesTotal: number } | null>;
}

function fakeIo(exportTo: (destDir: string) => Promise<typeof WRITTEN>): FakeIo {
  const io: FakeIo = {
    calls: [],
    progress: [],
    exportTo: (destDir) => {
      io.calls.push(`export ${destDir}`);
      return exportTo(destDir);
    },
    exportProgress: async () => {
      io.calls.push("status");
      return io.progress.shift() ?? null;
    },
    cancelExport: async () => {
      io.calls.push("cancel");
      return true;
    },
    mountExportTree: (treeUri) => {
      io.calls.push(`mount ${treeUri}`);
    },
    unmountExportTree: () => {
      io.calls.push("unmount");
    },
    releaseTree: (treeUri) => {
      io.calls.push(`release ${treeUri}`);
    },
    wait: async () => {
      io.calls.push("wait");
    },
  };
  return io;
}

/** An `exportTo` that settles when the test says so. */
function heldExport() {
  let settle: (result: typeof WRITTEN) => void = () => undefined;
  const pending = new Promise<typeof WRITTEN>((resolve) => {
    settle = resolve;
  });
  return { exportTo: () => pending, settle };
}

describe("createNativeDataFolderService", () => {
  it("writes into the picked tree through the export mount, then lets it go", async () => {
    const io = fakeIo(async () => WRITTEN);
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(` ${PICKED} `)).resolves.toEqual(WRITTEN);
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      "export /upriv-saf-export",
      "status",
      "unmount",
      `release ${PICKED}`,
    ]);
  });

  it("sends a filesystem folder to rust without a mount", async () => {
    const io = fakeIo(async () => WRITTEN);
    const service = createNativeDataFolderService(io);

    await service.exportTo("/storage/emulated/0/Download");
    expect(io.calls).toEqual(["export /storage/emulated/0/Download"]);
  });

  it("keeps the tree mounted until core stops after a timed-out call", async () => {
    const timeout = new RpcError("rpc_timeout", "invoke timeout");
    const io = fakeIo(async () => {
      throw timeout;
    });
    io.progress = [
      { bytesDone: 10, bytesTotal: 100 },
      { bytesDone: 10, bytesTotal: 100 },
    ];
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(PICKED)).rejects.toBe(timeout);
    // Core is still removing its partial zip through the mount until it reports no export.
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      "export /upriv-saf-export",
      "status",
      "wait",
      "status",
      "wait",
      "status",
      "unmount",
      `release ${PICKED}`,
    ]);
  });

  it("lets the tree go after a stopped export", async () => {
    const stopped = new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.CANCELLED, "stopped");
    const io = fakeIo(async () => {
      throw stopped;
    });
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(PICKED)).rejects.toBe(stopped);
    expect(io.calls.slice(-2)).toEqual(["unmount", `release ${PICKED}`]);
  });

  it("refuses a second export instead of moving the running one's writes", async () => {
    const held = heldExport();
    const io = fakeIo(held.exportTo);
    const service = createNativeDataFolderService(io);

    const first = service.exportTo(PICKED);
    const second = service.exportTo(OTHER);
    await expect(second).rejects.toSatisfy(
      (error: unknown) =>
        isRpcError(error) && error.code === DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY,
    );
    expect(io.calls).toEqual([`mount ${PICKED}`, "export /upriv-saf-export"]);

    held.settle(WRITTEN);
    await expect(first).resolves.toEqual(WRITTEN);
    expect(io.calls).not.toContain(`mount ${OTHER}`);
    expect(io.calls).not.toContain(`release ${OTHER}`);
  });

  it("drops the pick when the tree cannot be mounted, and can export again", async () => {
    const unreachable = new RpcError("saf_unreachable", "export folder is not reachable");
    const io = fakeIo(async () => WRITTEN);
    let mountFails = true;
    io.mountExportTree = (treeUri) => {
      io.calls.push(`mount ${treeUri}`);
      if (mountFails) throw unreachable;
    };
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(PICKED)).rejects.toBe(unreachable);
    expect(io.calls).toEqual([`mount ${PICKED}`, `release ${PICKED}`]);

    mountFails = false;
    io.calls = [];
    await expect(service.exportTo(OTHER)).resolves.toEqual(WRITTEN);
    expect(io.calls[0]).toBe(`mount ${OTHER}`);
  });

  it("releases an unused pick but never the running export's tree", async () => {
    const held = heldExport();
    const io = fakeIo(held.exportTo);
    const service = createNativeDataFolderService(io);

    const running = service.exportTo(PICKED);
    service.releaseDestination?.(PICKED);
    service.releaseDestination?.(OTHER);
    service.releaseDestination?.("/storage/emulated/0/Download");
    expect(io.calls).toEqual([`mount ${PICKED}`, "export /upriv-saf-export", `release ${OTHER}`]);

    held.settle(WRITTEN);
    await running;
    expect(io.calls.slice(-1)).toEqual([`release ${PICKED}`]);
  });

  it("asks core for progress and to stop", async () => {
    const io = fakeIo(async () => WRITTEN);
    io.progress = [{ bytesDone: 5, bytesTotal: 50 }];
    const service = createNativeDataFolderService(io);

    await expect(service.exportProgress()).resolves.toEqual({ bytesDone: 5, bytesTotal: 50 });
    await expect(service.cancelExport()).resolves.toBe(true);
    expect(io.calls).toEqual(["status", "cancel"]);
  });
});
