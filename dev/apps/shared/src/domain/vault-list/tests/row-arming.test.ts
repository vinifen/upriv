import { describe, expect, it } from "vitest";
import {
  ROW_ARM_CONFIRM_AFTER_MS,
  ROW_ARM_WINDOW_MS,
  ROW_ROLE_GUARD_MS,
  rowPress,
  vaultRowButtonRole,
  vaultRowButtonTwoStep,
} from "../rowArming";

const work = { startedAt: 1, timed: true, stoppingSince: null } as const;

describe("vaultRowButtonRole", () => {
  it("puts Stop in place of the button while the row's work can stop", () => {
    expect(vaultRowButtonRole("exporting", { ...work, stop: "ready" })).toBe("stop");
    expect(vaultRowButtonRole("opening", { ...work, stop: "final" })).toBe("stop_final");
    expect(vaultRowButtonRole("creating", { ...work, stop: "stopping" })).toBe("stopping");
  });

  it("is Lock, Unlock, or busy when the row has no Stop", () => {
    expect(vaultRowButtonRole("open", null)).toBe("lock");
    expect(vaultRowButtonRole("closed", undefined)).toBe("unlock");
    expect(vaultRowButtonRole("recovery", null)).toBe("unlock");
    expect(vaultRowButtonRole("closing", { ...work, stop: null })).toBe("busy");
  });
});

describe("vaultRowButtonTwoStep", () => {
  const ui = { lifecycle_confirm_stop: true, lifecycle_confirm_lock: false };

  it("follows each switch for its own roles", () => {
    expect(vaultRowButtonTwoStep("stop", ui)).toBe(true);
    expect(vaultRowButtonTwoStep("lock", ui)).toBe(false);
    expect(vaultRowButtonTwoStep("lock", { ...ui, lifecycle_confirm_lock: true })).toBe(true);
    expect(vaultRowButtonTwoStep("stop", { ...ui, lifecycle_confirm_stop: false })).toBe(false);
  });

  it("never asks twice for Unlock, which only opens its password window", () => {
    expect(vaultRowButtonTwoStep("unlock", { ...ui, lifecycle_confirm_lock: true })).toBe(false);
  });

  it("never asks twice for a button that does nothing", () => {
    for (const role of ["busy", "stop_final", "stopping"] as const) {
      expect(vaultRowButtonTwoStep(role, { ...ui, lifecycle_confirm_lock: true })).toBe(false);
    }
  });
});

const base = { now: 10_000, twoStep: true, armedAt: null, roleChangedAt: null };

describe("rowPress", () => {
  it("runs at once when the button asks for one press", () => {
    expect(rowPress({ ...base, twoStep: false })).toBe("run");
  });

  it("arms on the first press and runs on a second one", () => {
    expect(rowPress(base)).toBe("arm");
    expect(rowPress({ ...base, armedAt: base.now - ROW_ARM_CONFIRM_AFTER_MS })).toBe("run");
  });

  it("does not take a double click as the confirmation", () => {
    expect(rowPress({ ...base, armedAt: base.now - ROW_ARM_CONFIRM_AFTER_MS + 1 })).toBe("ignore");
  });

  it("arms again once the window to confirm has passed", () => {
    expect(rowPress({ ...base, armedAt: base.now - ROW_ARM_WINDOW_MS })).toBe("arm");
  });

  it("ignores presses just after the button changed what it does", () => {
    const changed = base.now - ROW_ROLE_GUARD_MS + 1;
    expect(rowPress({ ...base, roleChangedAt: changed })).toBe("ignore");
    expect(rowPress({ ...base, twoStep: false, roleChangedAt: changed })).toBe("ignore");
    expect(rowPress({ ...base, twoStep: false, roleChangedAt: base.now - ROW_ROLE_GUARD_MS })).toBe(
      "run",
    );
  });
});
