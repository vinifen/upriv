import { describe, expect, it } from "vitest";
import { vaultCanSaveBackupNow } from "..";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";

describe("vaultCanSaveBackupNow", () => {
  it("allows a closed, idle vault", () => {
    expect(vaultCanSaveBackupNow(vaultListItemFixture({ session: null }))).toBe(true);
  });

  it("refuses an open, closing, or recovering vault", () => {
    for (const session of ["open", "closing", "recovery"] as const) {
      expect(vaultCanSaveBackupNow(vaultListItemFixture({ session }))).toBe(false);
    }
  });

  it("refuses while this vault has work in flight, not while another one does", () => {
    const vault = vaultListItemFixture({ session: null });
    const busy = [
      { openingVaultIds: [vault.id] },
      { closingVaultIds: [vault.id] },
      { creatingVaultIds: [vault.id] },
      { queuedVaultIds: [vault.id] },
      { exportingVaultIds: [vault.id] },
      { backupJobVaultIds: [vault.id] },
      { passwordChangeVaultIds: [vault.id] },
      { kdfChangeVaultIds: [vault.id] },
    ];
    for (const pipeline of busy) {
      expect(vaultCanSaveBackupNow(vault, pipeline)).toBe(false);
    }
    expect(vaultCanSaveBackupNow(vault, { openingVaultIds: ["another"] })).toBe(true);
  });
});
