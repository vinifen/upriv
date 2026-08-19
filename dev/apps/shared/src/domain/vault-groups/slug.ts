import { displayNameToVaultId } from "../vault/displayName";

/** Slugify a group display name for `id` — same rules as vault ids. */
export function displayNameToGroupId(
  displayName: string,
  existingIds: readonly string[],
): string {
  return displayNameToVaultId(displayName, existingIds);
}
