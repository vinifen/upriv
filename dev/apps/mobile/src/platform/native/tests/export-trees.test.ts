import { describe, expect, it, vi } from "vitest";
import type { JobProgress } from "@upriv/shared";
import { createExportTrees, type ExportTreeIo } from "../exportTrees";

// The bridge is injected: the native module is not loaded.
vi.mock("upriv-core", () => ({ getUprivCoreNative: () => null }));

const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const ROOT = "/upriv-saf-tree/k1";

function io(patch: Partial<ExportTreeIo> = {}) {
  const calls: string[] = [];
  const bridge: ExportTreeIo = {
    jobStatus: async (): Promise<JobProgress | null> => null,
    checkTree: (uri) => calls.push(`check ${uri}`),
    mountTree: (uri) => {
      calls.push(`mount ${uri}`);
      return ROOT;
    },
    unmountTree: (uri) => calls.push(`unmount ${uri}`),
    releaseTree: (uri) => calls.push(`release ${uri}`),
    isListed: () => false,
    wait: async () => undefined,
    ...patch,
  };
  return { bridge, calls };
}

describe("export trees", () => {
  it("writes a path as it is, with no tree", async () => {
    const { bridge, calls } = io();
    const trees = createExportTrees(bridge);
    await expect(trees.withExportFolder("/sdcard/out", "job", async (dir) => dir)).resolves.toBe(
      "/sdcard/out",
    );
    expect(calls).toEqual([]);
  });

  it("writes into the picked tree's root, then lets it go once nothing holds it", async () => {
    const { bridge, calls } = io();
    const trees = createExportTrees(bridge);
    await expect(trees.withExportFolder(PICKED, "job", async (dir) => dir)).resolves.toBe(ROOT);
    expect(calls).toEqual([
      `check ${PICKED}`,
      `mount ${PICKED}`,
      `unmount ${PICKED}`,
      `release ${PICKED}`,
    ]);
  });

  it("keeps a folder a field holds until the field lets it go", async () => {
    const { bridge, calls } = io();
    const trees = createExportTrees(bridge);
    trees.hold(PICKED);
    await trees.withExportFolder(PICKED, "job", async () => undefined);
    expect(calls).not.toContain(`release ${PICKED}`);
    trees.release(PICKED);
    expect(calls.slice(-2)).toEqual([`unmount ${PICKED}`, `release ${PICKED}`]);
  });

  it("never lets go of a folder a row of this phone names", async () => {
    const { bridge, calls } = io({ isListed: () => true });
    const trees = createExportTrees(bridge);
    await trees.withExportFolder(PICKED, "job", async () => undefined);
    expect(calls).toEqual([`check ${PICKED}`, `mount ${PICKED}`]);
  });

  it("waits for the job to end before the tree goes", async () => {
    const status = vi
      .fn<() => Promise<JobProgress | null>>()
      .mockResolvedValueOnce({ bytesDone: 1, bytesTotal: 2, stoppable: true })
      .mockResolvedValue(null);
    const { bridge, calls } = io({ jobStatus: status });
    const trees = createExportTrees(bridge);
    await trees
      .withExportFolder(PICKED, "job", async () => {
        throw new Error("bridge failed");
      })
      .catch(() => undefined);
    expect(status).toHaveBeenCalledTimes(2);
    expect(calls.at(-1)).toBe(`release ${PICKED}`);
  });

  it("refuses a folder whose grant is gone, and mounts nothing", async () => {
    const { bridge, calls } = io({
      checkTree: () => {
        throw new Error("saf_unauthorized");
      },
    });
    const trees = createExportTrees(bridge);
    await expect(trees.withExportFolder(PICKED, "job", async () => undefined)).rejects.toThrow(
      "saf_unauthorized",
    );
    expect(calls).toEqual([]);
  });
});
