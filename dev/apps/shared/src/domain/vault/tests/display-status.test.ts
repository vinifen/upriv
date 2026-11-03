import { describe, expect, it } from "vitest";
import {
  isVaultBlockingDataFolderChange,
  isVaultBlockingWorkspaceClear,
  isVaultFileManagerEligible,
  isVaultFileManagerRetained,
  isVaultListClosed,
  isVaultPipelineDisplayBusy,
  isVaultOpenCredentialResumeStatus,
  isVaultOpenResumeTarget,
  vaultCloseNowOffered,
  isVaultCloseQueued,
  isVaultListRowUnlockTarget,
  listHasVaultBlockingDataFolderChange,
  listHasVaultBlockingWorkspaceClear,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  vaultDeleteHold,
  vaultRowJobWork,
  vaultRowWorkClock,
  vaultStatusLabelKey,
} from "..";
import { vaultRowFixture } from "./fixtures.shared";

describe("resolveVaultDisplayStatus", () => {
  it("prioritizes session over persistence", () => {
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ session: "recovery", storageMode: "encrypted_dir" }),
      ),
    ).toBe("recovery");
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ session: "closing", storageMode: "encrypted_dir" }),
      ),
    ).toBe("closing");
    expect(
      resolveVaultDisplayStatus(vaultRowFixture({ session: "open", storageMode: "encrypted_dir" })),
    ).toBe("open");
  });

  it("not-open is always closed", () => {
    expect(
      resolveVaultDisplayStatus(vaultRowFixture({ storageMode: "encrypted_dir", session: null })),
    ).toBe("closed");
    expect(
      resolveVaultDisplayStatus(vaultRowFixture({ storageMode: "upriv_plain", session: null })),
    ).toBe("closed");
  });
});

describe("resolveVaultListStatus", () => {
  it("overrides with pipeline opening/closing/creating/queued", () => {
    const row = vaultRowFixture({ id: "a", session: null });
    expect(resolveVaultListStatus(row, { openingVaultIds: ["a"] })).toBe("opening");
    expect(resolveVaultListStatus(row, { closingVaultIds: ["a"] })).toBe("closing");
    expect(resolveVaultListStatus(row, { creatingVaultIds: ["a"] })).toBe("creating");
    expect(resolveVaultListStatus(row, { queuedVaultIds: ["a"] })).toBe("queued");
    expect(isVaultListClosed(row, { openingVaultIds: ["a"] })).toBe(false);
    expect(isVaultListClosed(row, { queuedVaultIds: ["a"] })).toBe(false);
    expect(isVaultListClosed(row)).toBe(true);
    expect(isVaultListClosed(vaultRowFixture({ id: "a", session: "open" }))).toBe(false);
  });

  it("prefers active opening over queued for the same id", () => {
    const row = vaultRowFixture({ id: "a", session: null });
    expect(
      resolveVaultListStatus(row, {
        openingVaultIds: ["a"],
        queuedVaultIds: ["a"],
      }),
    ).toBe("opening");
  });

  it("treats creating and queued like other in-flight pipeline statuses", () => {
    expect(isVaultPipelineDisplayBusy("creating")).toBe(true);
    expect(isVaultPipelineDisplayBusy("opening")).toBe(true);
    expect(isVaultPipelineDisplayBusy("queued")).toBe(true);
    expect(isVaultPipelineDisplayBusy("closed")).toBe(false);
  });

  it("marks opening and queued as unlock-credential resume targets", () => {
    expect(isVaultOpenCredentialResumeStatus("opening")).toBe(true);
    expect(isVaultOpenCredentialResumeStatus("queued")).toBe(true);
    expect(isVaultOpenCredentialResumeStatus("closing")).toBe(false);
    expect(isVaultOpenResumeTarget("opening", "a")).toBe(true);
    expect(isVaultOpenResumeTarget("queued", "a", { queuedOpenVaultIds: ["a"] })).toBe(true);
    expect(isVaultOpenResumeTarget("queued", "a", { queuedOpenVaultIds: [] })).toBe(false);
    expect(isVaultOpenResumeTarget("queued", "a")).toBe(true);
    expect(isVaultCloseQueued("a", { queuedVaultIds: ["a"], queuedOpenVaultIds: [] })).toBe(true);
    expect(isVaultCloseQueued("a", { queuedVaultIds: ["a"], queuedOpenVaultIds: ["a"] })).toBe(
      false,
    );
    expect(isVaultCloseQueued("a", {})).toBe(false);
    expect(isVaultListRowUnlockTarget("opening")).toBe(true);
    expect(isVaultListRowUnlockTarget("open")).toBe(false);
    expect(isVaultListRowUnlockTarget("closing")).toBe(false);
  });

  it("names export and rewrap and refuses open", () => {
    const row = vaultRowFixture({ id: "a", session: null });
    expect(resolveVaultListStatus(row, { exportingVaultIds: ["a"] })).toBe("exporting");
    expect(resolveVaultListStatus(row, { backupJobVaultIds: ["a"] })).toBe("backing_up");
    expect(resolveVaultListStatus(row, { passwordChangeVaultIds: ["a"] })).toBe(
      "changing_password",
    );
    expect(resolveVaultListStatus(row, { kdfChangeVaultIds: ["a"] })).toBe("changing_kdf");
    expect(isVaultListRowUnlockTarget("backing_up")).toBe(false);
    expect(isVaultPipelineDisplayBusy("backing_up")).toBe(true);
    expect(isVaultListRowUnlockTarget("changing_password")).toBe(false);
    expect(isVaultListRowUnlockTarget("changing_kdf")).toBe(false);
    expect(isVaultListRowUnlockTarget("exporting")).toBe(false);
    expect(isVaultPipelineDisplayBusy("exporting")).toBe(true);
    expect(isVaultPipelineDisplayBusy("changing_password")).toBe(true);
    expect(isVaultPipelineDisplayBusy("changing_kdf")).toBe(true);
    expect(isVaultListClosed(row, { exportingVaultIds: ["a"] })).toBe(false);
  });
});

describe("a leftover folder being removed", () => {
  const row = vaultRowFixture({ id: "a", session: "recovery" });
  const wiping = { recoveringVaultIds: ["a"] };

  it("displays as recovering and leaves the other vaults alone", () => {
    expect(resolveVaultListStatus(row, wiping)).toBe("recovering");
    expect(resolveVaultListStatus(vaultRowFixture({ id: "b" }), wiping)).toBe("closed");
    expect(resolveVaultListStatus(row)).toBe("recovery");
  });

  it("is work in flight: the vault cannot be unlocked or deleted", () => {
    expect(isVaultPipelineDisplayBusy("recovering")).toBe(true);
    expect(isVaultListRowUnlockTarget("recovering")).toBe(false);
    expect(vaultDeleteHold(row, wiping)).toBe("busy");
  });
});

describe("vaultDeleteHold", () => {
  const closed = vaultRowFixture({ id: "a" });

  it("lets a closed vault or one in recovery start a delete", () => {
    expect(vaultDeleteHold(closed)).toBeNull();
    expect(vaultDeleteHold(vaultRowFixture({ id: "a", session: "recovery" }))).toBeNull();
  });

  it("waits while the vault is open or has work in flight", () => {
    expect(vaultDeleteHold(vaultRowFixture({ id: "a", session: "open" }))).toBe("busy");
    expect(vaultDeleteHold(vaultRowFixture({ id: "a", session: "closing" }))).toBe("busy");
    for (const pipeline of [
      { openingVaultIds: ["a"] },
      { creatingVaultIds: ["a"] },
      { queuedVaultIds: ["a"] },
      { exportingVaultIds: ["a"] },
    ]) {
      expect(vaultDeleteHold(closed, pipeline)).toBe("busy");
    }
  });

  it("waits while a backup export copies this vault's backups, and only this vault", () => {
    expect(vaultDeleteHold(closed, { backupExportVaultIds: ["a"] })).toBe("backup_export");
    expect(vaultDeleteHold(closed, { backupExportVaultIds: ["b"] })).toBeNull();
    expect(resolveVaultListStatus(closed, { backupExportVaultIds: ["a"] })).toBe("closed");
  });
});

describe("isVaultFileManagerEligible", () => {
  it("is true only when display status is open", () => {
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: "open" }))).toBe(true);
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: null }))).toBe(false);
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: "closing" }))).toBe(false);
  });
});

describe("isVaultFileManagerRetained", () => {
  it("keeps an existing tab while open or closing", () => {
    expect(isVaultFileManagerRetained(vaultRowFixture({ session: "open" }))).toBe(true);
    expect(isVaultFileManagerRetained(vaultRowFixture({ session: "closing" }))).toBe(true);
    expect(isVaultFileManagerRetained(vaultRowFixture({ session: null }))).toBe(false);
  });
});

describe("isVaultBlockingWorkspaceClear", () => {
  it("blocks clear while open, closing, or unlocking", () => {
    const open = vaultRowFixture({ id: "a", session: "open" });
    const closing = vaultRowFixture({ id: "a", session: "closing" });
    const closed = vaultRowFixture({ id: "a", session: null });
    expect(isVaultBlockingWorkspaceClear(open)).toBe(true);
    expect(isVaultBlockingWorkspaceClear(closing)).toBe(true);
    expect(isVaultBlockingWorkspaceClear(closed, { openingVaultIds: ["a"] })).toBe(true);
    expect(isVaultBlockingWorkspaceClear(closed, { queuedVaultIds: ["a"] })).toBe(true);
    expect(isVaultBlockingWorkspaceClear(closed)).toBe(false);
    expect(listHasVaultBlockingWorkspaceClear([closed], { openingVaultIds: ["a"] })).toBe(true);
  });
});

describe("isVaultBlockingDataFolderChange", () => {
  it("allows closed and recovery; blocks open/pipeline busy", () => {
    const closed = vaultRowFixture({ id: "a", session: null });
    const recovery = vaultRowFixture({ id: "b", session: "recovery" });
    const open = vaultRowFixture({ id: "c", session: "open" });
    expect(isVaultBlockingDataFolderChange(closed)).toBe(false);
    expect(isVaultBlockingDataFolderChange(recovery)).toBe(false);
    expect(isVaultBlockingDataFolderChange(open)).toBe(true);
    expect(isVaultBlockingDataFolderChange(closed, { openingVaultIds: ["a"] })).toBe(true);
    expect(isVaultBlockingDataFolderChange(closed, { closingVaultIds: ["a"] })).toBe(true);
    expect(isVaultBlockingDataFolderChange(closed, { creatingVaultIds: ["a"] })).toBe(true);
    expect(isVaultBlockingDataFolderChange(closed, { queuedVaultIds: ["a"] })).toBe(true);
    expect(listHasVaultBlockingDataFolderChange([closed, recovery])).toBe(false);
    expect(listHasVaultBlockingDataFolderChange([closed, open])).toBe(true);
  });
});

describe("vaultRowJobWork", () => {
  it("offers Stop while the job can stop, and disables it in its last step", () => {
    const running = { startedAt: 9, stoppable: true, stoppingSince: null };
    expect(vaultRowJobWork(running)).toEqual({
      startedAt: 9,
      timed: true,
      stop: "ready",
      stoppingSince: null,
    });
    expect(vaultRowJobWork({ ...running, stoppable: false }).stop).toBe("final");
  });

  it("says Stopping once Stop was asked for", () => {
    const work = vaultRowJobWork({ startedAt: 9, stoppable: true, stoppingSince: 30 });
    expect(work.stop).toBe("stopping");
    expect(work.stoppingSince).toBe(30);
  });

  it("can leave the clock out for work that is short by nature", () => {
    expect(
      vaultRowJobWork({ startedAt: 9, stoppable: true, stoppingSince: null, timed: false }),
    ).toMatchObject({ timed: false });
  });
});

describe("vaultRowWorkClock", () => {
  const work = vaultRowJobWork({ startedAt: 9, stoppable: true, stoppingSince: null });

  it("counts from when core started the work", () => {
    expect(vaultRowWorkClock(work)).toBe(9);
  });

  it("counts nothing while the work is queued, untimed, or absent", () => {
    expect(vaultRowWorkClock({ ...work, startedAt: null })).toBeNull();
    expect(vaultRowWorkClock({ ...work, timed: false })).toBeNull();
    expect(vaultRowWorkClock(undefined)).toBeNull();
  });

  it("counts Stopping from the stop, also for untimed work", () => {
    expect(vaultRowWorkClock({ ...work, timed: false, stop: "stopping", stoppingSince: 40 })).toBe(
      40,
    );
  });
});

describe("vaultStatusLabelKey", () => {
  it("offers Close now on a running or waiting close until it was asked for", () => {
    expect(vaultCloseNowOffered("closing", "a")).toBe(true);
    expect(
      vaultCloseNowOffered("queued", "a", { queuedVaultIds: ["a"], queuedOpenVaultIds: [] }),
    ).toBe(true);
    expect(
      vaultCloseNowOffered("queued", "a", { queuedVaultIds: ["a"], queuedOpenVaultIds: ["a"] }),
    ).toBe(false);
    expect(vaultCloseNowOffered("closing", "a", { closeNowVaultIds: ["a"] })).toBe(false);
    expect(vaultCloseNowOffered("open", "a")).toBe(false);
  });

  it("says auto-closed only for a closed vault that idle lock just finished", () => {
    expect(vaultStatusLabelKey("closed", "notes", {}, true)).toBe("vault.status.auto_closed");
    expect(vaultStatusLabelKey("closed", "notes")).toBe("vault.status.closed");
    expect(vaultStatusLabelKey("open", "notes", {}, true)).toBe("vault.status.open");
  });

  it("says Queued while the row's job waits for its lane, then the status", () => {
    const waiting = vaultRowJobWork({ startedAt: null, stoppable: true, stoppingSince: null });
    const running = vaultRowJobWork({ startedAt: 5, stoppable: true, stoppingSince: null });
    expect(vaultStatusLabelKey("exporting", "a", { rowWork: { a: waiting } })).toBe(
      "vault.status.queued",
    );
    expect(vaultStatusLabelKey("exporting", "a", { rowWork: { a: running } })).toBe(
      "vault.status.exporting",
    );
  });

  it("says Stopping once Stop was asked for", () => {
    const stopping = vaultRowJobWork({ startedAt: 5, stoppable: true, stoppingSince: 9 });
    expect(vaultStatusLabelKey("creating", "a", { rowWork: { a: stopping } })).toBe(
      "vault.status.stopping",
    );
  });
});
