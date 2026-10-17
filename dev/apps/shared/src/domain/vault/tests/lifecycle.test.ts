import { describe, expect, it } from "vitest";
import { canRunIdleAutoClose, requiresCloseDialog } from "..";
import { vaultRowFixture } from "./fixtures.shared";

describe("requiresCloseDialog", () => {
  it("skips the dialog for an encrypted vault", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(requiresCloseDialog(vault)).toBe(false);
  });

  it("starts lock immediately for an open plaintext vault", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "upriv_plain" });
    expect(requiresCloseDialog(vault)).toBe(false);
  });

  it("skips the dialog when a plaintext vault is already closed", () => {
    const vault = vaultRowFixture({ session: null, storageMode: "upriv_plain" });
    expect(requiresCloseDialog(vault)).toBe(false);
  });
});

describe("canRunIdleAutoClose", () => {
  it("runs for an open vault", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault)).toBe(true);
  });

  it("does not run when the vault is closed", () => {
    const vault = vaultRowFixture({ session: null, storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault)).toBe(false);
  });

  it("runs for an open plaintext vault so the future wipe uses the same close", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "upriv_plain" });
    expect(canRunIdleAutoClose(vault)).toBe(true);
    expect(requiresCloseDialog(vault)).toBe(false);
  });
});
