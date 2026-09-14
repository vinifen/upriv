import type { CreateVaultGroupAssignment, CreateVaultResult } from "../vault-create/types";
import { assignVaultToGroup, removeVaultFromGroups } from "../vault-groups/order";
import { normalizeVaultGroup } from "../vault-groups/normalize";
import { displayNameToGroupId } from "../vault-groups/slug";
import type { VaultGroup } from "../vault-groups/types";
import type { VaultListItem } from "./types";

/**
 * Optimistic list row while `vault_create` is queued or running.
 * `hidden` stays false so the row remains visible until the real list refresh.
 */
export function buildCreatingVaultListItem(result: CreateVaultResult): VaultListItem {
  const hint = result.passwordHint.trim();
  return {
    id: result.vaultId,
    displayName: result.displayName,
    session: null,
    storageMode: result.storageMode,
    order: result.order,
    passwordHint: hint.length > 0 ? hint : undefined,
    lastAccessedWhen: "",
    lastAccessedAt: "",
    note: result.note,
    unlockPreset: result.unlockPreset,
  };
}

/** Keep in-flight create placeholders across `vault_list` refresh. */
export function mergePendingCreatingVaults(
  listed: readonly VaultListItem[],
  pending: readonly VaultListItem[],
): VaultListItem[] {
  if (pending.length === 0) return [...listed];
  const listedIds = new Set(listed.map((row) => row.id));
  const extras = pending.filter((row) => !listedIds.has(row.id));
  return extras.length === 0 ? [...listed] : [...listed, ...extras];
}

/** Side-effect kept while create runs so group + vault paint together. */
export type PendingCreateGroupEffect =
  { kind: "create"; group: VaultGroup } | { kind: "existing"; groupId: string; vaultId: string };

/** Root `order` for a brand-new group — mirrors `create_vault_group` in upriv-core. */
export function nextVaultGroupOrder(groups: readonly VaultGroup[]): number {
  const maxOrder = groups.reduce((max, group) => Math.max(max, group.order), 0);
  return Math.max(maxOrder + 1, groups.length + 1);
}

/**
 * Resolve optimistic group membership at create submit time.
 * Returns `null` when the vault stays ungrouped.
 */
export function buildPendingCreateGroupEffect(
  assignment: CreateVaultGroupAssignment,
  vaultId: string,
  existingGroups: readonly VaultGroup[],
): PendingCreateGroupEffect | null {
  if (assignment.kind === "none") return null;
  if (assignment.kind === "existing") {
    return { kind: "existing", groupId: assignment.groupId, vaultId };
  }
  const id = displayNameToGroupId(
    assignment.displayName,
    existingGroups.map((group) => group.id),
  );
  return {
    kind: "create",
    group: normalizeVaultGroup({
      id,
      displayName: assignment.displayName,
      order: nextVaultGroupOrder(existingGroups),
      collapsed: false,
      hidden: false,
      groupedVaults: [vaultId],
    }),
  };
}

/** Apply optimistic membership immediately (same moment as the vault placeholder). */
export function applyPendingCreateGroupEffect(
  groups: readonly VaultGroup[],
  effect: PendingCreateGroupEffect,
): VaultGroup[] {
  if (effect.kind === "create") {
    if (groups.some((group) => group.id === effect.group.id)) {
      return assignVaultToGroup([...groups], effect.group.groupedVaults[0]!, effect.group.id);
    }
    return [...groups, effect.group];
  }
  return assignVaultToGroup([...groups], effect.vaultId, effect.groupId);
}

/** Drop optimistic membership when create fails or is cancelled. */
export function rollbackPendingCreateGroupEffect(
  groups: readonly VaultGroup[],
  effect: PendingCreateGroupEffect,
): VaultGroup[] {
  if (effect.kind === "create") {
    return groups.filter((group) => group.id !== effect.group.id);
  }
  return removeVaultFromGroups([...groups], effect.vaultId);
}

/**
 * Keep optimistic create/group membership across `vault_group_list` refresh
 * until the vault (and group create) land on disk.
 */
export function mergePendingCreatingGroups(
  listed: readonly VaultGroup[],
  pending: Iterable<PendingCreateGroupEffect>,
): VaultGroup[] {
  let next = listed.map((group) =>
    normalizeVaultGroup({ ...group, groupedVaults: [...group.groupedVaults] }),
  );
  for (const effect of pending) {
    if (effect.kind === "create") {
      const vaultId = effect.group.groupedVaults[0];
      const existing = next.find((group) => group.id === effect.group.id);
      if (existing) {
        if (vaultId && !existing.groupedVaults.includes(vaultId)) {
          next = assignVaultToGroup(next, vaultId, effect.group.id);
        }
        continue;
      }
      next = [...next, effect.group];
      continue;
    }
    const already = next.some((group) => group.groupedVaults.includes(effect.vaultId));
    if (!already) {
      next = assignVaultToGroup(next, effect.vaultId, effect.groupId);
    }
  }
  return next;
}

/** Stable group id for the create RPC — never re-slug after the optimistic row. */
export function pendingCreateGroupId(
  effect: PendingCreateGroupEffect | undefined,
  assignment: CreateVaultGroupAssignment,
  existingGroupIds: readonly string[],
): string | null {
  if (assignment.kind === "create") {
    return effect?.kind === "create"
      ? effect.group.id
      : displayNameToGroupId(assignment.displayName, existingGroupIds);
  }
  return assignment.kind === "existing" ? assignment.groupId : null;
}
