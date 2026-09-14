import { describe, expect, it } from "vitest";
import { isVaultOpenJobPending } from "../openPending";

describe("isVaultOpenJobPending", () => {
  it("is true for the active open run", () => {
    expect(
      isVaultOpenJobPending("a", { vaultId: "a", kind: "open" }, [{ vaultId: "b", kind: "open" }]),
    ).toBe(true);
  });

  it("is true for a queued open job", () => {
    expect(
      isVaultOpenJobPending("b", { vaultId: "a", kind: "open" }, [{ vaultId: "b", kind: "open" }]),
    ).toBe(true);
  });

  it("is false for queued close/create or unrelated vaults", () => {
    expect(
      isVaultOpenJobPending("b", { vaultId: "a", kind: "open" }, [{ vaultId: "b", kind: "close" }]),
    ).toBe(false);
    expect(isVaultOpenJobPending("c", { vaultId: "a", kind: "open" }, [])).toBe(false);
  });
});
