import { describe, expect, it } from "vitest";
import {
  canRunIdleAutoClose,
  requiresPasswordForLifecycle,
  resolveIdleAutoCloseIntent,
} from "..";
import { vaultRowFixture } from "./fixtures.shared";

describe("resolveIdleAutoCloseIntent", () => {
  it.each([
    ["ram_only", "close", "seal"],
    ["plain_only", "close", "seal"],
    ["plain", "close", "seal"],
    ["store_only", "close", "close"],
    ["store_only", "seal", "seal"],
    ["encrypted_dir", "seal", "seal"],
  ] as const)("%s + close=%s → %s", (storageMode, closeDefault, expected) => {
    expect(resolveIdleAutoCloseIntent(storageMode, closeDefault)).toBe(expected);
  });
});

describe("requiresPasswordForLifecycle", () => {
  const openVault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
  const closedVault = vaultRowFixture({ session: null, persistence: "closed" });

  it("always requires password for unlock", () => {
    expect(requiresPasswordForLifecycle(openVault, "unlock", "session_ram", true)).toBe(true);
    expect(requiresPasswordForLifecycle(openVault, "unlock", "disk_open_close", true)).toBe(true);
  });

  it("never requires password to seal a closed vault", () => {
    expect(requiresPasswordForLifecycle(closedVault, "seal", "session_ram", false)).toBe(false);
  });

  it("prompt_open_close requires password on close while open", () => {
    expect(requiresPasswordForLifecycle(openVault, "close", "always_prompt", true)).toBe(true);
    expect(requiresPasswordForLifecycle(openVault, "close", "always_prompt", false)).toBe(true);
  });

  it("disk_open_close skips password on close while open", () => {
    expect(requiresPasswordForLifecycle(openVault, "close", "disk_open_close", false)).toBe(false);
  });

  it("session_ram requires password on close when not in RAM", () => {
    expect(requiresPasswordForLifecycle(openVault, "close", "session_ram", false)).toBe(true);
    expect(requiresPasswordForLifecycle(openVault, "close", "session_ram", true)).toBe(false);
  });
});

describe("canRunIdleAutoClose", () => {
  it("returns false when password would be required", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault, "encrypted_dir", "session_ram", "close", false)).toBe(false);
  });

  it("returns true when auto-close can run without prompt", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault, "encrypted_dir", "session_ram", "close", true)).toBe(true);
  });
});
