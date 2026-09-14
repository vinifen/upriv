import { describe, expect, it, vi } from "vitest";
import { createLiveVaultService } from "./createLiveVaultService";

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
});
