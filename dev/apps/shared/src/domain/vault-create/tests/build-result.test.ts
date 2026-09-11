import { describe, expect, it } from "vitest";
import { buildCreateVaultResult } from "..";
import { createVaultDraftFixture } from "./fixtures";

describe("buildCreateVaultResult", () => {
  it("builds normalized settings and vault id from draft", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([1, 2], {
        displayName: "My Vault",
        storage: { mode: "upriv_plain" },
        security: { mode: "session_ram", secure_wipe_workspace: true },
      }),
      ["existing-id"],
    );

    expect(result.vaultId).toBe("my-vault");
    expect(result.storageMode).toBe("upriv_plain");
    expect(result.settings.storage.mode).toBe("upriv_plain");
    expect(result.settings.vault.display_name).toBe("My Vault");
    expect(result.unlockPreset).toBe("256mib");
    expect(result.settings.security.mode).toBe("session_ram");
    expect(result.settings.vault.order).toBe(3);
    expect(result.groupAssignment).toEqual({ kind: "none" });
  });

  it("carries unlock preset for a `.7z` import (new contents/ is wrapped here)", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importFileName: "backup.7z",
        kdf: { unlock_preset: "1gib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBe("1gib");
  });

  it("writes no unlock preset for a `.zip` import (vault.header owns the cost)", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importFileName: "contents.zip",
        kdf: { unlock_preset: "64mib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBeUndefined();
  });

  it("writes no unlock preset for create-from-backup (copy contents/; do not rewrite KDF)", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importFileName: "20260528T120000",
        importFilePath: "vaults/cold-storage/backups/20260528T120000",
        kdf: { unlock_preset: "64mib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBeUndefined();
  });

  it("carries deferred existing-group assignment", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        groupMode: "existing",
        groupId: "work",
      }),
      [],
    );
    expect(result.groupAssignment).toEqual({ kind: "existing", groupId: "work" });
  });

  it("carries deferred create-group assignment", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        groupMode: "create",
        groupName: "  Travel  ",
      }),
      [],
    );
    expect(result.groupAssignment).toEqual({ kind: "create", displayName: "Travel" });
  });
});
