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
  isVaultListRowActivatable,
  isVaultListRowUnlockTarget,
  listHasVaultBlockingDataFolderChange,
  listHasVaultBlockingWorkspaceClear,
  pipelineActiveStartedAt,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  vaultDeleteHold,
  vaultPipelineRowBudget,
  vaultStatusLabelKey,
} from "..";
import { LOADING_BUDGET_MS } from "../../loading/budget";
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

  it("exposes the active job start only for that vault", () => {
    const pipeline = { activeVaultId: "a", activeStartedAt: 1_000 };
    expect(pipelineActiveStartedAt(pipeline, "a")).toBe(1_000);
    expect(pipelineActiveStartedAt(pipeline, "b")).toBeUndefined();
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
    expect(isVaultListRowActivatable("queued")).toBe(true);
    expect(isVaultListRowUnlockTarget("opening")).toBe(true);
    expect(isVaultListRowUnlockTarget("open")).toBe(false);
    expect(isVaultListRowActivatable("closing")).toBe(false);
  });

  it("names export and rewrap and refuses open", () => {
    const row = vaultRowFixture({ id: "a", session: null });
    expect(resolveVaultListStatus(row, { exportingVaultIds: ["a"] })).toBe("exporting");
    expect(resolveVaultListStatus(row, { backupJobVaultIds: ["a"] })).toBe("backing_up");
    expect(resolveVaultListStatus(row, { passwordChangeVaultIds: ["a"] })).toBe(
      "changing_password",
    );
    expect(resolveVaultListStatus(row, { kdfChangeVaultIds: ["a"] })).toBe("changing_kdf");
    expect(isVaultListRowActivatable("exporting")).toBe(false);
    expect(isVaultListRowActivatable("backing_up")).toBe(false);
    expect(isVaultListRowUnlockTarget("backing_up")).toBe(false);
    expect(isVaultPipelineDisplayBusy("backing_up")).toBe(true);
    expect(isVaultListRowActivatable("changing_password")).toBe(false);
    expect(isVaultListRowActivatable("changing_kdf")).toBe(false);
    expect(isVaultListRowUnlockTarget("exporting")).toBe(false);
    expect(isVaultPipelineDisplayBusy("exporting")).toBe(true);
    expect(isVaultPipelineDisplayBusy("changing_password")).toBe(true);
    expect(isVaultPipelineDisplayBusy("changing_kdf")).toBe(true);
    expect(isVaultListClosed(row, { exportingVaultIds: ["a"] })).toBe(false);
  });
});

describe("a leftover folder being removed", () => {
  const row = vaultRowFixture({ id: "a", session: "recovery" });
  const wiping = { recoveringVaultIds: ["a"], recoveringStartedAt: 5, recoveringBudgetMs: 9_000 };

  it("displays as recovering and leaves the other vaults alone", () => {
    expect(resolveVaultListStatus(row, wiping)).toBe("recovering");
    expect(resolveVaultListStatus(vaultRowFixture({ id: "b" }), wiping)).toBe("closed");
    expect(resolveVaultListStatus(row)).toBe("recovery");
  });

  it("is work in flight: the row cannot be opened and the vault cannot be deleted", () => {
    expect(isVaultPipelineDisplayBusy("recovering")).toBe(true);
    expect(isVaultListRowActivatable("recovering")).toBe(false);
    expect(isVaultListRowUnlockTarget("recovering")).toBe(false);
    expect(vaultDeleteHold(row, wiping)).toBe("busy");
  });

  it("shows the clock and the budget of the wipe on the row", () => {
    expect(vaultPipelineRowBudget("recovering", wiping, "a")).toEqual({
      active: true,
      budgetMs: 9_000,
      startedAt: 5,
    });
    expect(vaultPipelineRowBudget("recovering", {}, "a").active).toBe(false);
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

describe("vaultPipelineRowBudget", () => {
  it("activates only for the active opening or creating job", () => {
    const pipeline = { activeVaultId: "a", activeStartedAt: 9 };
    expect(vaultPipelineRowBudget("opening", pipeline, "a")).toEqual({
      active: true,
      budgetMs: LOADING_BUDGET_MS.vaultPipeline,
      startedAt: 9,
    });
    expect(vaultPipelineRowBudget("creating", pipeline, "a")).toEqual({
      active: true,
      budgetMs: LOADING_BUDGET_MS.vaultCreate,
      startedAt: 9,
    });
    expect(vaultPipelineRowBudget("opening", pipeline, "b").active).toBe(false);
    expect(vaultPipelineRowBudget("closing", pipeline, "a").active).toBe(false);
    expect(vaultPipelineRowBudget("queued", pipeline, "a").active).toBe(false);
  });

  it("counts a password or unlock-RAM change from its own start", () => {
    const pipeline = { rewrapStartedAt: 40 };
    expect(vaultPipelineRowBudget("changing_password", pipeline, "a")).toEqual({
      active: true,
      budgetMs: LOADING_BUDGET_MS.vaultRewrap,
      startedAt: 40,
    });
    expect(vaultPipelineRowBudget("changing_kdf", pipeline, "a")).toEqual({
      active: true,
      budgetMs: LOADING_BUDGET_MS.vaultRewrap,
      startedAt: 40,
    });
    expect(vaultPipelineRowBudget("changing_password", {}, "a").active).toBe(false);
    expect(vaultPipelineRowBudget("opening", pipeline, "a").active).toBe(false);
  });

  it("counts Back up now from its own start", () => {
    const pipeline = { backupJobStartedAt: 12 };
    expect(vaultPipelineRowBudget("backing_up", pipeline, "a")).toEqual({
      active: true,
      budgetMs: LOADING_BUDGET_MS.vaultBackupSave,
      startedAt: 12,
    });
    expect(vaultPipelineRowBudget("backing_up", {}, "a").active).toBe(false);
  });

  it("shows the budget the work was sized to", () => {
    const sized = 3 * LOADING_BUDGET_MS.vaultRewrap;
    expect(
      vaultPipelineRowBudget("changing_kdf", { rewrapStartedAt: 5, rewrapBudgetMs: sized }, "a"),
    ).toEqual({ active: true, budgetMs: sized, startedAt: 5 });
    expect(
      vaultPipelineRowBudget(
        "backing_up",
        { backupJobStartedAt: 7, backupJobBudgetMs: sized },
        "a",
      ),
    ).toEqual({ active: true, budgetMs: sized, startedAt: 7 });
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
});
