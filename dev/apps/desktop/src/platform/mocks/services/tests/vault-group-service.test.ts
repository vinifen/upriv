import { afterEach, describe, expect, it } from "vitest";
import { RpcError, VAULT_ERROR_CODES } from "@upriv/shared";
import { registerMockVaultId } from "../../data/vaults";
import {
  mockVaultGroupService,
  resetMockVaultGroups,
  setMockVaultGroupsInvalid,
} from "../vaultGroupService";

afterEach(() => {
  resetMockVaultGroups();
});

describe("mockVaultGroupService", () => {
  it("rejects unknown vault ids on create", async () => {
    await expect(
      mockVaultGroupService.create({
        id: "work",
        displayName: "Work",
        groupedVaults: ["ghost-vault"],
      }),
    ).rejects.toMatchObject({ code: VAULT_ERROR_CODES.NOT_FOUND });
  });

  it("accepts wizard-registered vault ids", async () => {
    registerMockVaultId("wizard-notes");
    const group = await mockVaultGroupService.create({
      id: "work",
      displayName: "Work",
      groupedVaults: ["wizard-notes"],
    });
    expect(group.groupedVaults).toEqual(["wizard-notes"]);
  });

  it("rejects a partial membership reorder", async () => {
    registerMockVaultId("a");
    registerMockVaultId("b");
    await mockVaultGroupService.create({
      id: "work",
      displayName: "Work",
      groupedVaults: ["a", "b"],
    });
    await expect(mockVaultGroupService.reorderGroupedVaults("work", ["a"])).rejects.toBeInstanceOf(
      RpcError,
    );
  });

  it("rejects a duplicate group id", async () => {
    await mockVaultGroupService.create({
      id: "work",
      displayName: "Work",
    });
    await expect(
      mockVaultGroupService.create({
        id: "work",
        displayName: "Work 2",
      }),
    ).rejects.toMatchObject({ code: VAULT_ERROR_CODES.GROUPS_INVALID });
  });

  it("rejects mutations while the groups file is invalid", async () => {
    setMockVaultGroupsInvalid(true);
    await expect(
      mockVaultGroupService.create({
        id: "work",
        displayName: "Work",
      }),
    ).rejects.toMatchObject({ code: VAULT_ERROR_CODES.GROUPS_INVALID });
  });

  it("rejects delete of a missing group", async () => {
    await expect(mockVaultGroupService.delete("missing")).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.GROUP_NOT_FOUND,
    });
  });
});
