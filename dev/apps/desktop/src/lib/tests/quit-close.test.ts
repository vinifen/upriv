import { describe, expect, it } from "vitest";
import { nextQuitClose, type QuitCloseVault } from "../quitClose";

const waiting: QuitCloseVault = {
  vaultId: "notes",
  name: "Notes",
  stage: "waiting",
  startedAt: null,
};

describe("nextQuitClose", () => {
  it("stays waiting while core still holds the vault open", () => {
    expect(nextQuitClose(waiting, { state: "open" }, 1_000)).toEqual(waiting);
  });

  it("counts from the first answer that the close runs, and follows its step", () => {
    const flushing = nextQuitClose(waiting, { state: "closing", phase: "flush" }, 1_000);
    expect(flushing).toMatchObject({ stage: "flush", startedAt: 1_000 });
    const backing = nextQuitClose(flushing, { state: "closing", phase: "backup" }, 5_000);
    expect(backing).toMatchObject({ stage: "backup", startedAt: 1_000 });
  });

  it("marks a close that ended between two answers as closed", () => {
    expect(nextQuitClose(waiting, { state: "closed" }, 1_000).stage).toBe("closed");
  });

  it("keeps the last step when an answer is missing, and never undoes a close", () => {
    const flushing = nextQuitClose(waiting, { state: "closing", phase: "flush" }, 1_000);
    expect(nextQuitClose(flushing, null, 2_000)).toBe(flushing);
    const closed = nextQuitClose(flushing, { state: "closed" }, 3_000);
    expect(nextQuitClose(closed, { state: "open" }, 4_000)).toBe(closed);
  });
});
