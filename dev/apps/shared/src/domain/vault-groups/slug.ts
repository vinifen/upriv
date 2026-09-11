import type { CreateVaultGroupAssignment } from "../vault-create/types";
import { displayNameToVaultId } from "../vault/displayName";

/** Slugify a group display name for `id` — same rules as vault ids. */
export function displayNameToGroupId(displayName: string, existingIds: readonly string[]): string {
  return displayNameToVaultId(displayName, existingIds);
}

/**
 * Picker value after a group save. Slug **before** create lands in `existingIds`
 * — re-slugging afterwards mints a `-2` suffix and the form stays dirty.
 */
export function selectedGroupIdAfterAssignment(
  assignment: CreateVaultGroupAssignment,
  existingGroupIds: readonly string[],
): string {
  if (assignment.kind === "create") {
    return displayNameToGroupId(assignment.displayName, existingGroupIds);
  }
  return assignment.kind === "existing" ? assignment.groupId : "";
}
