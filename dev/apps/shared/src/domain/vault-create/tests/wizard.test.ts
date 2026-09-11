import { describe, expect, it } from "vitest";
import {
  getCreateVaultStepStatus,
  resolveCreateVaultFocusTarget,
  resolveCreateVaultOpenStep,
  shouldSelectCreateVaultFocusText,
  shouldShowCreateVaultInlineErrors,
} from "..";
import { createVaultDraftFixture } from "./fixtures";

describe("resolveCreateVaultOpenStep", () => {
  it("opens at source for an empty draft", () => {
    expect(resolveCreateVaultOpenStep(null, null)).toBe("source");
  });

  it("opens at identity when a prefilled draft has no explicit step", () => {
    expect(resolveCreateVaultOpenStep(createVaultDraftFixture(), null)).toBe("identity");
  });

  it("honors an explicit initial step", () => {
    expect(resolveCreateVaultOpenStep(null, "password")).toBe("password");
  });
});

describe("resolveCreateVaultFocusTarget", () => {
  it("focuses the step default on first visit", () => {
    expect(resolveCreateVaultFocusTarget("identity", undefined, false)).toBe("displayName");
    expect(resolveCreateVaultFocusTarget("password", undefined, false)).toBe("password");
  });

  it("does not steal focus when returning to a step untouched", () => {
    expect(resolveCreateVaultFocusTarget("identity", undefined, true)).toBeNull();
  });

  it("restores where the user left off", () => {
    expect(resolveCreateVaultFocusTarget("identity", "note", true)).toBe("note");
  });

  it("returns null for steps without a text field", () => {
    expect(resolveCreateVaultFocusTarget("source", undefined, false)).toBeNull();
    expect(resolveCreateVaultFocusTarget("advanced", undefined, false)).toBeNull();
  });
});

describe("shouldSelectCreateVaultFocusText", () => {
  it("selects the vault name so typing replaces a prefilled value", () => {
    expect(shouldSelectCreateVaultFocusText("displayName")).toBe(true);
    expect(shouldSelectCreateVaultFocusText("password")).toBe(false);
  });
});

describe("shouldShowCreateVaultInlineErrors", () => {
  it("hides inline errors until the step is attempted", () => {
    expect(shouldShowCreateVaultInlineErrors("identity", new Set(), false)).toBe(false);
    expect(shouldShowCreateVaultInlineErrors("identity", new Set(["identity"]), false)).toBe(true);
  });
});

describe("getCreateVaultStepStatus", () => {
  it("shows incomplete before attempt even when invalid", () => {
    expect(
      getCreateVaultStepStatus(
        "identity",
        createVaultDraftFixture([], { displayName: "" }),
        [],
        new Set(),
        false,
      ),
    ).toBe("incomplete");
  });

  it("shows error after the step was attempted", () => {
    expect(
      getCreateVaultStepStatus(
        "identity",
        createVaultDraftFixture([], { displayName: "" }),
        [],
        new Set(["identity"]),
        false,
      ),
    ).toBe("error");
  });
});
