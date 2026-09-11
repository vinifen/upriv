import { describe, expect, it } from "vitest";
import { isVaultFileManagerEligible, resolveVaultDisplayStatus, resolveVaultListStatus } from "..";
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
  it("overrides with pipeline opening/closing", () => {
    const row = vaultRowFixture({ id: "a", session: null });
    expect(resolveVaultListStatus(row, { openingVaultIds: ["a"] })).toBe("opening");
    expect(resolveVaultListStatus(row, { closingVaultIds: ["a"] })).toBe("closing");
  });
});

describe("isVaultFileManagerEligible", () => {
  it("is true only when display status is open", () => {
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: "open" }))).toBe(true);
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: null }))).toBe(false);
  });
});
