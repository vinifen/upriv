import { describe, expect, it } from "vitest";
import { canRunIdleAutoClose, requiresCloseDialog, requiresPasswordForLifecycle } from "..";
import { vaultRowFixture } from "./fixtures.shared";

describe("requiresPasswordForLifecycle", () => {
  const openVault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
  const closedVault = vaultRowFixture({ session: null });

  it("always requires password for unlock", () => {
    expect(requiresPasswordForLifecycle(openVault, "unlock", "session_ram")).toBe(true);
    expect(requiresPasswordForLifecycle(openVault, "unlock", "disk_open_close")).toBe(true);
  });

  it("does not require password to close a closed vault", () => {
    expect(requiresPasswordForLifecycle(closedVault, "close", "session_ram")).toBe(false);
  });

  it("prompt_open_close requires password on close while open", () => {
    expect(requiresPasswordForLifecycle(openVault, "close", "always_prompt")).toBe(true);
  });

  it("legacy ram_on_close_only does not require password on close", () => {
    expect(requiresPasswordForLifecycle(openVault, "close", "ram_on_close_only")).toBe(false);
  });

  it("session_ram and disk modes skip password on close", () => {
    expect(requiresPasswordForLifecycle(openVault, "close", "session_ram")).toBe(false);
    expect(requiresPasswordForLifecycle(openVault, "close", "disk_close")).toBe(false);
    expect(requiresPasswordForLifecycle(openVault, "close", "disk_open_close")).toBe(false);
  });
});

describe("requiresCloseDialog", () => {
  it("skips the dialog for default encrypted_dir lock", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(requiresCloseDialog(vault, "session_ram")).toBe(false);
  });

  it("shows the dialog for always_prompt", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(requiresCloseDialog(vault, "always_prompt")).toBe(true);
  });

  it("shows the dialog to confirm upriv_plain wipe", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "upriv_plain" });
    expect(requiresCloseDialog(vault, "session_ram")).toBe(true);
  });
});

describe("canRunIdleAutoClose", () => {
  it("returns false when always_prompt would require a password", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault, "always_prompt")).toBe(false);
  });

  it("returns true when lock does not need a password", () => {
    const vault = vaultRowFixture({ session: "open", storageMode: "encrypted_dir" });
    expect(canRunIdleAutoClose(vault, "session_ram")).toBe(true);
    expect(canRunIdleAutoClose(vault, "ram_on_close_only")).toBe(true);
    expect(canRunIdleAutoClose(vault, "disk_close")).toBe(true);
  });
});
