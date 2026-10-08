import { describe, expect, it, vi } from "vitest";
import { createLiveVaultService } from "./createLiveVaultService";
import { forgetVaultSettings, peekVaultSettings } from "./vaultSettingsMemory";

describe("createLiveVaultService", () => {
  it("does not relist for unlock preset", async () => {
    const listVaults = vi.fn(async () => []);
    const service = createLiveVaultService({
      listVaults,
      createVault: vi.fn(),
      getSettings: vi.fn(),
    });
    await expect(service.getUnlockPreset("notes")).resolves.toBeUndefined();
    expect(listVaults).not.toHaveBeenCalled();
    expect(service.canPersistSettings).toBe(false);
  });

  it("enables persist when saveSettings is wired", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const service = createLiveVaultService({
      listVaults: vi.fn(async () => []),
      createVault: vi.fn(),
      getSettings: vi.fn(),
      saveSettings,
    });
    expect(service.canPersistSettings).toBe(true);
    const config = { vault: { id: "notes" } } as never;
    await service.registerSettings("notes", config);
    expect(saveSettings).toHaveBeenCalledWith("notes", config);
  });

  it("forwards rename when wired", async () => {
    const rename = vi.fn(async () => ({
      id: "work-docs",
      previousId: "notes",
      displayName: "Work Docs",
      idChanged: true,
    }));
    const service = createLiveVaultService({
      listVaults: vi.fn(async () => []),
      createVault: vi.fn(),
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
      rename,
    });
    await expect(service.rename("notes", "Work Docs")).resolves.toEqual({
      id: "work-docs",
      previousId: "notes",
      displayName: "Work Docs",
      idChanged: true,
    });
    expect(rename).toHaveBeenCalledWith("notes", "Work Docs");
  });

  it("routes a files zip away from the store-zip import", async () => {
    const importZip = vi.fn();
    const importFilesZip = vi.fn(async () => ({ id: "photos" }) as never);
    const createVault = vi.fn();
    const service = createLiveVaultService({
      listVaults: vi.fn(async () => []),
      createVault,
      getSettings: vi.fn(),
      importZip,
      importFilesZip,
    });
    await service.createVault({
      password: "secret",
      settings: { vault: { id: "photos" } } as never,
      importPackage: { kind: "files_zip", archivePath: "/tmp/Photos.zip" },
    });
    expect(importFilesZip).toHaveBeenCalledOnce();
    expect(importZip).not.toHaveBeenCalled();
    expect(createVault).not.toHaveBeenCalled();
  });

  it("forwards export password probe when wired", async () => {
    const probeExportPassword = vi.fn(async () => true);
    const service = createLiveVaultService({
      listVaults: vi.fn(async () => []),
      createVault: vi.fn(),
      getSettings: vi.fn(),
      probeExportPassword,
    });
    await expect(service.probeExportPassword("notes", "pass-word-ok")).resolves.toBe(true);
    expect(probeExportPassword).toHaveBeenCalledWith("notes", "pass-word-ok");
  });

  it("keeps the last read so preferences can open without waiting", async () => {
    forgetVaultSettings("notes");
    const config = { vault: { id: "notes", display_name: "Notes" } } as never;
    const saveSettings = vi.fn(async () => undefined);
    const deleteVault = vi.fn(async () => undefined);
    const service = createLiveVaultService({
      listVaults: vi.fn(async () => []),
      createVault: vi.fn(),
      getSettings: vi.fn(async () => config),
      saveSettings,
      deleteVault,
    });
    expect(peekVaultSettings("notes")).toBeUndefined();
    await service.getSettings("notes");
    expect(peekVaultSettings("notes")).toEqual(config);
    expect(peekVaultSettings("notes")).not.toBe(config);
    await service.registerSettings("notes", config);
    expect(peekVaultSettings("notes")).toEqual(config);
    await service.unregisterSettings("notes");
    expect(peekVaultSettings("notes")).toBeUndefined();
  });
});
