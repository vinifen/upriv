import { describe, expect, it } from "vitest";
import { dragKeyRefersToVaultId, groupedVaultDragKey, pickListDropTarget } from "../drag-keys";

describe("pickListDropTarget", () => {
  it("prefers grouped vault, in-group ungroup, then root vault when dragging inside a group", () => {
    const keys = ["vault:v1", "list:ungroup:g1", groupedVaultDragKey("g1", "v2"), "group:g1"];
    expect(pickListDropTarget(keys, groupedVaultDragKey("g1", "v1"))).toBe(
      groupedVaultDragKey("g1", "v2"),
    );
    expect(
      pickListDropTarget(["vault:v1", "list:ungroup:g1"], groupedVaultDragKey("g1", "v1")),
    ).toBe("list:ungroup:g1");
    expect(pickListDropTarget(["vault:v1", "group:g1"], groupedVaultDragKey("g1", "v1"))).toBe(
      "vault:v1",
    );
  });

  it("treats same-group body as no-op target instead of root ungroup when re-dropping", () => {
    expect(pickListDropTarget(["group:g1", "list:ungroup"], groupedVaultDragKey("g1", "v1"))).toBe(
      "group:g1",
    );
    expect(pickListDropTarget(["list:ungroup"], groupedVaultDragKey("g1", "v1"))).toBe(
      "list:ungroup",
    );
  });

  it("prefers group target when dragging a group row", () => {
    const keys = [groupedVaultDragKey("g2", "v1"), "group:g2", "vault:v1"];
    expect(pickListDropTarget(keys, "group:g1")).toBe("group:g2");
  });

  it("prefers grouped vault position, then group body, when dragging an ungrouped vault", () => {
    const keys = ["group:g1", groupedVaultDragKey("g1", "v2"), "vault:v3"];
    expect(pickListDropTarget(keys, "vault:v1")).toBe(groupedVaultDragKey("g1", "v2"));
    expect(pickListDropTarget(["group:g1", "vault:v3"], "vault:v1")).toBe("group:g1");
  });

  it("ignores the drag source key", () => {
    expect(pickListDropTarget(["group:g1"], "group:g1")).toBeNull();
  });
});

describe("dragKeyRefersToVaultId", () => {
  it("matches the full vault id on root and grouped keys, not a substring", () => {
    expect(dragKeyRefersToVaultId("vault:taxes", "tax")).toBe(false);
    expect(dragKeyRefersToVaultId("vault:taxes", "taxes")).toBe(true);
    expect(dragKeyRefersToVaultId(groupedVaultDragKey("work", "notes"), "notes")).toBe(true);
    expect(dragKeyRefersToVaultId("group:work", "work")).toBe(false);
  });
});
