import { describe, expect, it } from "vitest";
import { buildCreateVaultResult } from "..";
import { createVaultDraftFixture } from "./fixtures";

describe("buildCreateVaultResult", () => {
  it("builds normalized settings and vault id from draft", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([1, 2], {
        displayName: "My Vault",
        storage: { mode: "upriv_plain" },
        security: {
          mode: "session_ram",
          secure_wipe_workspace: true,
          wipe_passes: 1,
          wipe_pattern: "random",
        },
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
    expect(result.source).toBe("scratch");
  });

  it("carries unlock preset for a `.7z` import (new store/ is wrapped here)", () => {
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

  it("writes no unlock preset for a Upriv `.zip` (vault.header owns the cost)", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importFileName: "notes.zip",
        zipLayout: "store",
        kdf: { unlock_preset: "64mib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBeUndefined();
  });

  it("carries unlock preset when the .zip is ordinary files", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importFileName: "Photos.zip",
        zipLayout: "files",
        kdf: { unlock_preset: "128mib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBe("128mib");
  });

  it("writes no unlock preset for create-from-backup (copy store/; do not rewrite KDF)", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importKind: "backup",
        importFileName: "20260528120000-notes.zip",
        importFilePath: "vaults/notes/backups/20260528120000-notes.zip",
        kdf: { unlock_preset: "64mib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBeUndefined();
  });

  it("still chooses a preset when the file only lives under a folder named backups", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        source: "import",
        importFileName: "Photos.7z",
        importFilePath: "vaults/notes/backups/Photos.7z",
        kdf: { unlock_preset: "64mib" },
      }),
      [],
    );
    expect(result.unlockPreset).toBe("64mib");
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

  it("collapses extra spaces in vault and group names", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        displayName: "My    Vault",
        groupMode: "create",
        groupName: "Work    Notes",
      }),
      [],
    );
    expect(result.displayName).toBe("My Vault");
    expect(result.settings.vault.display_name).toBe("My Vault");
    expect(result.groupAssignment).toEqual({ kind: "create", displayName: "Work Notes" });
  });

  it("keeps wipe and seven_zip values from the draft", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        security: {
          mode: "always_prompt",
          secure_wipe_workspace: false,
          wipe_passes: 3,
          wipe_pattern: "zeros",
        },
        seven_zip: {
          encrypt_file_names: false,
          archive_mode: "compress_encrypt",
          compression_level: 9,
          solid: true,
          method: "lzma2",
        },
      }),
      [],
    );
    expect(result.settings.security.wipe_passes).toBe(3);
    expect(result.settings.security.wipe_pattern).toBe("zeros");
    expect(result.settings.seven_zip.compression_level).toBe(9);
    expect(result.settings.seven_zip.solid).toBe(true);
    expect(result.settings.seven_zip.encrypt_file_names).toBe(false);
  });
});
