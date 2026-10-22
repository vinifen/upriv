import { describe, expect, it, vi } from "vitest";
import { JOB_ERROR_CODES, RpcError, VAULT_ERROR_CODES, isRpcError } from "@upriv/shared";

vi.mock("@/lib/rpc", () => ({
  rpcJobStatus: vi.fn(),
}));

vi.mock("../safVaultRoot", () => ({
  mountSafExport: vi.fn(),
  unmountSafExport: vi.fn(),
  safReleaseImportTree: vi.fn(),
}));

import { createSafExportMount, type SafExportIo } from "../safExportMount";

const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const OTHER = "content://com.android.externalstorage.documents/tree/primary%3AMusic";
const JOB = "job-phone-copy";
const BUDGET_MS = 60_000;
const WRITTEN = { path: "/upriv-saf-export/Notes.zip", size: 4096 };

interface FakeIo extends SafExportIo {
  calls: string[];
  /** Answers for `jobStatus`, oldest first. Empty means the job no longer runs. */
  progress: Array<{ bytesDone: number; bytesTotal: number } | null>;
}

function fakeIo(): FakeIo {
  const io: FakeIo = {
    calls: [],
    progress: [],
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

/** A write that records the folder core was given, then settles as `result` says. */
function writer(io: FakeIo, result: () => Promise<typeof WRITTEN> = async () => WRITTEN) {
  return (dir: string) => {
    io.calls.push(`write ${dir}`);
    return result();
  };
}

/** A write that settles when the test says so. */
function heldWrite(io: FakeIo) {
  let settle: (result: typeof WRITTEN) => void = () => undefined;
  const pending = new Promise<typeof WRITTEN>((resolve) => {
    settle = resolve;
  });
  return { write: writer(io, () => pending), settle };
}

describe("createSafExportMount", () => {
  it("writes into a picked tree through the export mount, and keeps a held pick", async () => {
    const io = fakeIo();
    const mount = createSafExportMount(io);
    mount.hold(PICKED);

    await expect(
      mount.withExportFolder(` ${PICKED} `, JOB, BUDGET_MS, writer(io)),
    ).resolves.toEqual(WRITTEN);
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      "write /upriv-saf-export",
      `status ${JOB}`,
      "unmount",
    ]);

    // The field still holds it: the next export writes there again.
    io.calls = [];
    await mount.withExportFolder(PICKED, JOB, BUDGET_MS, writer(io));
    expect(io.calls[0]).toBe(`mount ${PICKED}`);
    expect(io.calls).not.toContain(`release ${PICKED}`);
  });

  it("sends a filesystem folder to rust without a mount", async () => {
    const io = fakeIo();
    const mount = createSafExportMount(io);

    await mount.withExportFolder("/storage/emulated/0/Download", JOB, BUDGET_MS, writer(io));
    expect(io.calls).toEqual(["write /storage/emulated/0/Download"]);
  });

  it("keeps the tree mounted until core stops after a timed-out call", async () => {
    const io = fakeIo();
    io.progress = [
      { bytesDone: 1, bytesTotal: 10 },
      { bytesDone: 2, bytesTotal: 10 },
    ];
    const mount = createSafExportMount(io);
    mount.hold(PICKED);
    const timeout = new RpcError("rpc_timeout", "invoke timeout");

    await expect(
      mount.withExportFolder(
        PICKED,
        JOB,
        BUDGET_MS,
        writer(io, async () => {
          throw timeout;
        }),
      ),
    ).rejects.toBe(timeout);
    // Core is still removing its partial file through the mount until its job ends.
    expect(io.calls).toEqual([
      `mount ${PICKED}`,
      "write /upriv-saf-export",
      `status ${JOB}`,
      "wait",
      `status ${JOB}`,
      "wait",
      `status ${JOB}`,
      "unmount",
    ]);
  });

  it("unmounts after a stopped export and leaves the pick to its field", async () => {
    const io = fakeIo();
    const mount = createSafExportMount(io);
    mount.hold(PICKED);
    const stopped = new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped");

    await expect(
      mount.withExportFolder(
        PICKED,
        JOB,
        BUDGET_MS,
        writer(io, async () => {
          throw stopped;
        }),
      ),
    ).rejects.toBe(stopped);
    expect(io.calls.slice(-1)).toEqual(["unmount"]);
    expect(io.calls).not.toContain(`release ${PICKED}`);
  });

  it("refuses a second export instead of moving the running one's writes", async () => {
    const io = fakeIo();
    const mount = createSafExportMount(io);
    mount.hold(PICKED);
    mount.hold(OTHER);
    const held = heldWrite(io);

    const first = mount.withExportFolder(PICKED, JOB, BUDGET_MS, held.write);
    const second = mount.withExportFolder(OTHER, "job-other", BUDGET_MS, writer(io));
    await expect(second).rejects.toSatisfy(
      (error: unknown) => isRpcError(error) && error.code === VAULT_ERROR_CODES.VAULT_BUSY,
    );
    expect(io.calls).toEqual([`mount ${PICKED}`, "write /upriv-saf-export"]);

    held.settle(WRITTEN);
    await expect(first).resolves.toEqual(WRITTEN);
    expect(io.calls).not.toContain(`mount ${OTHER}`);
  });

  it("keeps the pick when the tree cannot be mounted, and can export again", async () => {
    const io = fakeIo();
    const unreachable = new RpcError("saf_unreachable", "export folder is not reachable");
    let mountFails = true;
    io.mountExportTree = (treeUri) => {
      io.calls.push(`mount ${treeUri}`);
      if (mountFails) throw unreachable;
    };
    const mount = createSafExportMount(io);
    mount.hold(PICKED);

    await expect(mount.withExportFolder(PICKED, JOB, BUDGET_MS, writer(io))).rejects.toBe(
      unreachable,
    );
    expect(io.calls).toEqual([`mount ${PICKED}`]);

    mountFails = false;
    io.calls = [];
    await expect(mount.withExportFolder(PICKED, JOB, BUDGET_MS, writer(io))).resolves.toEqual(
      WRITTEN,
    );
    expect(io.calls[0]).toBe(`mount ${PICKED}`);
  });

  it("drops a folder's access only once every field let it go", () => {
    const io = fakeIo();
    const mount = createSafExportMount(io);

    // The .zip and the .7z fields both keep the same folder.
    mount.hold(PICKED);
    mount.hold(PICKED);
    mount.release(PICKED);
    expect(io.calls).toEqual([]);
    mount.release(PICKED);
    expect(io.calls).toEqual([`release ${PICKED}`]);

    // A pick no field kept is dropped at once; a filesystem path holds no grant.
    mount.release(OTHER);
    mount.hold("/storage/emulated/0/Download");
    mount.release("/storage/emulated/0/Download");
    expect(io.calls).toEqual([`release ${PICKED}`, `release ${OTHER}`]);
  });

  it("waits for an export still writing into a folder its field let go", async () => {
    const io = fakeIo();
    const mount = createSafExportMount(io);
    mount.hold(PICKED);
    const held = heldWrite(io);

    const running = mount.withExportFolder(PICKED, JOB, BUDGET_MS, held.write);
    mount.release(PICKED);
    expect(io.calls).not.toContain(`release ${PICKED}`);

    held.settle(WRITTEN);
    await running;
    expect(io.calls.slice(-2)).toEqual(["unmount", `release ${PICKED}`]);
  });
});
