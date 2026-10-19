import { describe, expect, it } from "vitest";
import { canRunIdleAutoClose } from "..";
import { vaultRowFixture } from "./fixtures.shared";

describe("canRunIdleAutoClose", () => {
  it("runs for an open vault", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault)).toBe(true);
  });

  it("does not run when the vault is closed", () => {
    const vault = vaultRowFixture({ session: null, storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault)).toBe(false);
  });

  it("runs for an open plaintext vault, whose close wipes its folder", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "upriv_plain" });
    expect(canRunIdleAutoClose(vault)).toBe(true);
  });
});
