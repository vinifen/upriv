import { describe, expect, it } from "vitest";
import {
  isVaultFileManagerEligible,
  resolveVaultCanSeal,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
} from "..";
import { vaultRowFixture } from "./fixtures.shared";

describe("resolveVaultDisplayStatus", () => {
  it("prioritizes session over persistence", () => {
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ session: "recovery", persistence: "closed", storageMode: "encrypted_dir" }),
      ),
    ).toBe("recovery");
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ session: "closing", persistence: "closed", storageMode: "encrypted_dir" }),
      ),
    ).toBe("closing");
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ session: "open", persistence: "sealed", storageMode: "encrypted_dir" }),
      ),
    ).toBe("open");
  });

  it.each(["plain", "plain_only", "ram_only"] as const)(
    "seal-only mode %s always shows sealed when not open",
    (storageMode) => {
      expect(
        resolveVaultDisplayStatus(
          vaultRowFixture({ storageMode, session: null, persistence: "closed" }),
        ),
      ).toBe("sealed");
    },
  );

  it("closed-cache modes respect persistence when not open", () => {
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ storageMode: "encrypted_dir", session: null, persistence: "closed" }),
      ),
    ).toBe("closed");
    expect(
      resolveVaultDisplayStatus(
        vaultRowFixture({ storageMode: "store_only", session: null, persistence: "sealed" }),
      ),
    ).toBe("sealed");
  });
});

describe("resolveVaultCanSeal", () => {
  it("allows seal split for closed-cache modes when open or closed", () => {
    expect(
      resolveVaultCanSeal(
        vaultRowFixture({ storageMode: "encrypted_dir", session: "open", persistence: "closed" }),
      ),
    ).toBe(true);
    expect(
      resolveVaultCanSeal(
        vaultRowFixture({ storageMode: "store_only", session: null, persistence: "closed" }),
      ),
    ).toBe(true);
    expect(
      resolveVaultCanSeal(
        vaultRowFixture({ storageMode: "store_only", session: null, persistence: "sealed" }),
      ),
    ).toBe(false);
  });

  it("never allows seal split for seal-only modes", () => {
    expect(
      resolveVaultCanSeal(
        vaultRowFixture({ storageMode: "plain_only", session: "open", canSeal: true }),
      ),
    ).toBe(false);
  });

  it("blocks seal during recovery or closing", () => {
    expect(
      resolveVaultCanSeal(
        vaultRowFixture({ storageMode: "encrypted_dir", session: "recovery" }),
      ),
    ).toBe(false);
    expect(
      resolveVaultCanSeal(
        vaultRowFixture({ storageMode: "encrypted_dir", session: "closing" }),
      ),
    ).toBe(false);
  });
});

describe("resolveVaultListStatus", () => {
  it("overrides with pipeline opening/closing", () => {
    const row = vaultRowFixture({ id: "a", session: null, persistence: "closed" });
    expect(resolveVaultListStatus(row, { openingVaultIds: ["a"] })).toBe("opening");
    expect(resolveVaultListStatus(row, { closingVaultIds: ["a"] })).toBe("closing");
  });
});

describe("isVaultFileManagerEligible", () => {
  it("is true only when display status is open", () => {
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: "open" }))).toBe(true);
    expect(isVaultFileManagerEligible(vaultRowFixture({ session: null, persistence: "closed" }))).toBe(
      false,
    );
  });
});
