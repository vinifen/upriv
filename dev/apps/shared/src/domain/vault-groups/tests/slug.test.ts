import { describe, expect, it } from "vitest";
import { displayNameToGroupId, selectedGroupIdAfterAssignment } from "../slug";
import { slugIdIsValid } from "../slugId";
import { normalizeVaultGroup } from "../normalize";

describe("slugIdIsValid", () => {
  it("accepts a lowercase hyphenated id", () => {
    expect(slugIdIsValid("my-notes")).toBe(true);
  });

  it("rejects reserved, padded, and oversized ids", () => {
    expect(slugIdIsValid("con")).toBe(false);
    expect(slugIdIsValid("-notes")).toBe(false);
    expect(slugIdIsValid("notes-")).toBe(false);
    expect(slugIdIsValid("Notes")).toBe(false);
    expect(slugIdIsValid("a".repeat(65))).toBe(false);
  });
});

describe("displayNameToGroupId", () => {
  it("slugifies like vault ids and avoids collisions", () => {
    expect(displayNameToGroupId("Work Notes", [])).toBe("work-notes");
    expect(displayNameToGroupId("Work Notes", ["work-notes"])).toBe("work-notes-2");
  });
});

describe("selectedGroupIdAfterAssignment", () => {
  it("slugs create against the pre-create id list", () => {
    expect(
      selectedGroupIdAfterAssignment({ kind: "create", displayName: "Medical Records" }, []),
    ).toBe("medical-records");
    expect(
      selectedGroupIdAfterAssignment({ kind: "create", displayName: "Medical Records" }, [
        "medical-records",
      ]),
    ).toBe("medical-records-2");
  });

  it("keeps an existing group id and clears none", () => {
    expect(selectedGroupIdAfterAssignment({ kind: "existing", groupId: "work" }, [])).toBe("work");
    expect(selectedGroupIdAfterAssignment({ kind: "none" }, ["work"])).toBe("");
  });
});

describe("normalizeVaultGroup", () => {
  it("accepts snake_case wire aliases and defaults sort", () => {
    const group = normalizeVaultGroup({
      id: "  work  ",
      displayName: "  Work  ",
      grouped_vaults: [" notes ", ""],
      grouped_vault_sort: "nope",
      grouped_vault_sort_direction: "desc",
    });
    expect(group.id).toBe("work");
    expect(group.groupedVaults).toEqual(["notes"]);
    expect(group.groupedVaultSort).toBe("order");
    expect(group.groupedVaultSortDirection).toBe("desc");
  });
});
