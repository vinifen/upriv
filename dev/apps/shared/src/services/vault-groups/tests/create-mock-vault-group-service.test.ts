import { describe, expect, it } from "vitest";
import { createMockVaultGroupService } from "../createMockVaultGroupService";

describe("createMockVaultGroupService hidden cascade", () => {
  it("hides members when a group is created or updated as hidden, and unhides them on unhide", async () => {
    const hidden = new Set<string>();
    const { service } = createMockVaultGroupService({
      getKnownVaultIds: () => ["notes", "taxes"],
      hideVaults: (ids) => {
        for (const id of ids) hidden.add(id);
      },
      unhideVaults: (ids) => {
        for (const id of ids) hidden.delete(id);
      },
    });

    await service.create({
      id: "work",
      displayName: "Work",
      groupedVaults: ["notes"],
      hidden: true,
    });
    expect([...hidden]).toEqual(["notes"]);

    await service.update({
      id: "work",
      groupedVaults: ["notes", "taxes"],
    });
    expect(hidden.has("taxes")).toBe(true);

    await service.update({ id: "work", hidden: false });
    expect(hidden.size).toBe(0);

    await service.update({ id: "work", hidden: true });
    expect(hidden.has("notes")).toBe(true);
    expect(hidden.has("taxes")).toBe(true);
    await service.delete("work");
    expect(hidden.has("notes")).toBe(true);
    expect(hidden.has("taxes")).toBe(true);
  });

  it("does not hide members of a visible group", async () => {
    const hidden: string[] = [];
    const { service } = createMockVaultGroupService({
      getKnownVaultIds: () => ["notes"],
      hideVaults: (ids) => hidden.push(...ids),
    });

    await service.create({
      id: "home",
      displayName: "Home",
      groupedVaults: ["notes"],
    });
    expect(hidden).toEqual([]);
  });

  it("hides vaults removed in the same update that hides the group", async () => {
    const hidden = new Set<string>();
    let groupHiddenLogs = 0;
    const { service } = createMockVaultGroupService({
      getKnownVaultIds: () => ["notes", "taxes"],
      hideVaults: (ids) => {
        for (const id of ids) hidden.add(id);
      },
      onGroupHidden: () => {
        groupHiddenLogs += 1;
      },
    });

    await service.create({
      id: "work",
      displayName: "Work",
      groupedVaults: ["notes", "taxes"],
    });
    await service.update({
      id: "work",
      groupedVaults: ["notes"],
      hidden: true,
    });
    expect(hidden.has("notes")).toBe(true);
    expect(hidden.has("taxes")).toBe(true);
    expect(groupHiddenLogs).toBe(1);
  });
});
