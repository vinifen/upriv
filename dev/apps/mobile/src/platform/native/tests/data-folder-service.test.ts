import { describe, expect, it, vi } from "vitest";
import {
  DATA_FOLDER_EXPORT_ERROR_CODES,
  JOB_ERROR_CODES,
  RpcError,
  isRpcError,
} from "@upriv/shared";

vi.mock("@/lib/rpc", () => ({
  rpcDataFolderExport: vi.fn(),
  rpcJobStatus: vi.fn(),
}));

vi.mock("../safVaultRoot", () => ({
  mountSafExport: vi.fn(),
  unmountSafExport: vi.fn(),
  safReleaseImportTree: vi.fn(),
}));

import { createNativeDataFolderService, type NativeDataFolderIo } from "../dataFolderService";

const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const OTHER = "content://com.android.externalstorage.documents/tree/primary%3AMusic";
const NAME = "phone-copy";
const JOB = "job-phone-copy";
const WRITTEN = { path: `/upriv-saf-export/${NAME}.zip`, size: 4096 };

interface FakeIo extends NativeDataFolderIo {
  calls: string[];
  /** Answers for `jobStatus`, oldest first. Empty means the job no longer runs. */
  progress: Array<{ bytesDone: number; bytesTotal: number } | null>;
}

function fakeIo(exportTo: (destDir: string) => Promise<typeof WRITTEN>): FakeIo {
  const io: FakeIo = {
    calls: [],
    progress: [],
    exportTo: (destDir, name, job) => {
      io.calls.push(`export ${destDir} as ${name} (${job})`);
      return exportTo(destDir);
    },
    jobStatus: async (job) => {
      io.calls.push(`status ${job}`);
      return io.progress.shift() ?? null;
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
  it("writes into the picked tree through the export mount and keeps the pick", async () => {
    const io = fakeIo(async () => WRITTEN);
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(` ${PICKED} `, NAME, JOB)).resolves.toEqual(WRITTEN);
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      `export /upriv-saf-export as ${NAME} (${JOB})`,
      `status ${JOB}`,
      "unmount",
    ]);

    // The window still holds it: the next export writes there again.
    io.calls = [];
    await service.exportTo(PICKED, NAME, JOB);
    expect(io.calls[0]).toBe(`mount ${PICKED}`);
    expect(io.calls).not.toContain(`release ${PICKED}`);
  });

  it("sends a filesystem folder to rust without a mount", async () => {
    const io = fakeIo(async () => WRITTEN);
    const service = createNativeDataFolderService(io);

    await service.exportTo("/storage/emulated/0/Download", NAME, JOB);
    expect(io.calls).toEqual([`export /storage/emulated/0/Download as ${NAME} (${JOB})`]);
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

    await expect(service.exportTo(PICKED, NAME, JOB)).rejects.toBe(timeout);
    // Core is still removing its partial zip through the mount until its job ends.
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      `export /upriv-saf-export as ${NAME} (${JOB})`,
      `status ${JOB}`,
      "wait",
      `status ${JOB}`,
      "wait",
      `status ${JOB}`,
      "unmount",
    ]);
  });

  it("unmounts after a stopped export and leaves the pick to the window", async () => {
    const stopped = new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped");
    const io = fakeIo(async () => {
      throw stopped;
    });
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(PICKED, NAME, JOB)).rejects.toBe(stopped);
    expect(io.calls.slice(-1)).toEqual(["unmount"]);
    expect(io.calls).not.toContain(`release ${PICKED}`);
  });

  it("refuses a second export instead of moving the running one's writes", async () => {
    const held = heldExport();
    const io = fakeIo(held.exportTo);
    const service = createNativeDataFolderService(io);

    const first = service.exportTo(PICKED, NAME, JOB);
    const second = service.exportTo(OTHER, NAME, JOB);
    await expect(second).rejects.toSatisfy(
      (error: unknown) =>
        isRpcError(error) && error.code === DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY,
    );
    expect(io.calls).toEqual([`mount ${PICKED}`, `export /upriv-saf-export as ${NAME} (${JOB})`]);

    held.settle(WRITTEN);
    await expect(first).resolves.toEqual(WRITTEN);
    expect(io.calls).not.toContain(`mount ${OTHER}`);
    expect(io.calls).not.toContain(`release ${OTHER}`);
  });

  it("keeps the pick when the tree cannot be mounted, and can export again", async () => {
    const unreachable = new RpcError("saf_unreachable", "export folder is not reachable");
    const io = fakeIo(async () => WRITTEN);
    let mountFails = true;
    io.mountExportTree = (treeUri) => {
      io.calls.push(`mount ${treeUri}`);
      if (mountFails) throw unreachable;
    };
    const service = createNativeDataFolderService(io);

    await expect(service.exportTo(PICKED, NAME, JOB)).rejects.toBe(unreachable);
    expect(io.calls).toEqual([`mount ${PICKED}`]);

    mountFails = false;
    io.calls = [];
    await expect(service.exportTo(PICKED, NAME, JOB)).resolves.toEqual(WRITTEN);
    expect(io.calls[0]).toBe(`mount ${PICKED}`);
  });

  it("lets go of a pick the window drops, waiting for an export still using it", async () => {
    const held = heldExport();
    const io = fakeIo(held.exportTo);
    const service = createNativeDataFolderService(io);

    const running = service.exportTo(PICKED, NAME, JOB);
    service.releaseDestination?.(PICKED);
    service.releaseDestination?.(OTHER);
    service.releaseDestination?.("/storage/emulated/0/Download");
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      `export /upriv-saf-export as ${NAME} (${JOB})`,
      `release ${OTHER}`,
    ]);

    held.settle(WRITTEN);
    await running;
    expect(io.calls.slice(-1)).toEqual([`release ${PICKED}`]);
  });
});
