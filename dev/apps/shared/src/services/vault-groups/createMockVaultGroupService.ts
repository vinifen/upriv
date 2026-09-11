import { DEFAULT_GROUPED_VAULT_SORT, GROUPED_VAULT_SORT_MODES } from "../../domain/vault-list/sort";
import {
  normalizeVaultGroup,
  slugIdIsValid,
  type VaultGroup,
  type VaultGroupCreateInput,
  type VaultGroupListResult,
  type VaultGroupUpdateInput,
} from "../../domain/vault-groups";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import { RpcError } from "../../domain/core-rpc/errors";
import type { VaultGroupService } from "./VaultGroupService";

function uniqueVaultIds(left: readonly string[], right: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...left, ...right]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function cloneGroup(group: VaultGroup): VaultGroup {
  return normalizeVaultGroup({ ...group, groupedVaults: [...group.groupedVaults] });
}

function cloneAll(groups: readonly VaultGroup[]): VaultGroup[] {
  return groups.map(cloneGroup);
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].map((id) => id.trim()).sort();
  const b = [...right].map((id) => id.trim()).sort();
  return a.every((id, i) => id === b[i]);
}

function assertGroupId(id: string): void {
  if (!slugIdIsValid(id.trim())) {
    throw new RpcError(VAULT_ERROR_CODES.GROUPS_INVALID, `invalid group id: ${id}`);
  }
}

function assertDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new RpcError(VAULT_ERROR_CODES.GROUPS_INVALID, "display_name is empty");
  }
  return trimmed;
}

function assertGroupedVaultSort(mode: string | undefined): string | undefined {
  if (mode == null) return undefined;
  if (!(GROUPED_VAULT_SORT_MODES as readonly string[]).includes(mode)) {
    throw new RpcError(VAULT_ERROR_CODES.GROUPS_INVALID, `invalid grouped_vault_sort: ${mode}`);
  }
  return mode;
}

function assertSortDirection(direction: string | undefined): string | undefined {
  if (direction == null) return undefined;
  if (direction !== "asc" && direction !== "desc") {
    throw new RpcError(
      VAULT_ERROR_CODES.GROUPS_INVALID,
      `invalid grouped_vault_sort_direction: ${direction}`,
    );
  }
  return direction;
}

/** Soft-sanitize list payload: drop unknown vault ids, first-wins dual membership. */
function sanitizeListed(
  groups: VaultGroup[],
  known: Set<string>,
): { groups: VaultGroup[]; droppedOrphans: number; droppedDuplicateAssignments: number } {
  let droppedOrphans = 0;
  let droppedDuplicateAssignments = 0;
  const claimed = new Set<string>();
  const out: VaultGroup[] = [];
  for (const group of groups) {
    const groupedVaults: string[] = [];
    const seenInGroup = new Set<string>();
    for (const raw of group.groupedVaults) {
      const id = raw.trim();
      if (!id || seenInGroup.has(id)) continue;
      seenInGroup.add(id);
      if (!known.has(id)) {
        droppedOrphans += 1;
        continue;
      }
      if (claimed.has(id)) {
        droppedDuplicateAssignments += 1;
        continue;
      }
      claimed.add(id);
      groupedVaults.push(id);
    }
    out.push(cloneGroup({ ...group, groupedVaults }));
  }
  return { groups: out, droppedOrphans, droppedDuplicateAssignments };
}

export interface MockVaultGroupServiceOptions {
  getKnownVaultIds: () => Iterable<string>;
  initialGroups?: readonly VaultGroup[];
  /** Persist `[vault].hidden` on members when a group is hidden or unhidden. */
  hideVaults?: (vaultIds: readonly string[]) => void;
  unhideVaults?: (vaultIds: readonly string[]) => void;
  /** Fired when a group flips to hidden (no id/name — same contract as CORE). */
  onGroupHidden?: () => void;
}

export interface MockVaultGroupServiceHandle {
  service: VaultGroupService;
  setInvalid: (invalid: boolean) => void;
  reset: (groups?: readonly VaultGroup[]) => void;
}

/** In-memory `VaultGroupService` shared by desktop and mobile mocks. */
export function createMockVaultGroupService(
  options: MockVaultGroupServiceOptions,
): MockVaultGroupServiceHandle {
  const seed = cloneAll(options.initialGroups ?? []);
  let groups = cloneAll(seed);
  let invalid = false;

  function findIndex(id: string): number {
    return groups.findIndex((g) => g.id === id);
  }

  function assertMutable(): void {
    if (invalid) {
      throw new RpcError(VAULT_ERROR_CODES.GROUPS_INVALID, "vault groups file is invalid");
    }
  }

  function cascadeHideMembers(group: VaultGroup): void {
    if (!group.hidden || group.groupedVaults.length === 0) return;
    options.hideVaults?.(group.groupedVaults);
  }

  function cascadeUnhideMembers(previous: VaultGroup, next: VaultGroup): void {
    if (!previous.hidden || next.hidden || next.groupedVaults.length === 0) return;
    options.unhideVaults?.(next.groupedVaults);
  }

  function assertKnownVaultIds(ids: readonly string[]): void {
    const known = new Set(options.getKnownVaultIds());
    for (const raw of ids) {
      const id = raw.trim();
      if (!id || !known.has(id)) {
        throw new RpcError(VAULT_ERROR_CODES.NOT_FOUND, `vault not found: ${raw}`);
      }
    }
  }

  const service: VaultGroupService = {
    async list(): Promise<VaultGroupListResult> {
      if (invalid) {
        return {
          groups: [],
          invalid: true,
          droppedOrphans: 0,
          droppedDuplicateAssignments: 0,
        };
      }
      const known = new Set(options.getKnownVaultIds());
      const sanitized = sanitizeListed(groups, known);
      return {
        groups: sanitized.groups,
        invalid: sanitized.droppedDuplicateAssignments > 0,
        droppedOrphans: sanitized.droppedOrphans,
        droppedDuplicateAssignments: sanitized.droppedDuplicateAssignments,
      };
    },

    async create(input: VaultGroupCreateInput): Promise<VaultGroup> {
      assertMutable();
      assertGroupId(input.id);
      const displayName = assertDisplayName(input.displayName);
      assertGroupedVaultSort(input.groupedVaultSort);
      assertSortDirection(input.groupedVaultSortDirection);
      if (findIndex(input.id) >= 0) {
        throw new RpcError(
          VAULT_ERROR_CODES.GROUPS_INVALID,
          `group id already exists: ${input.id}`,
        );
      }
      const maxOrder = groups.reduce((max, g) => Math.max(max, g.order), 0);
      const groupedVaults = [...(input.groupedVaults ?? [])];
      assertKnownVaultIds(groupedVaults);
      if (groupedVaults.length > 0) {
        const vaultSet = new Set(groupedVaults);
        groups = groups.map((g) => ({
          ...g,
          groupedVaults: g.groupedVaults.filter((m) => !vaultSet.has(m)),
        }));
      }
      const group = normalizeVaultGroup({
        id: input.id.trim(),
        displayName,
        order: maxOrder + 1,
        collapsed: false,
        hidden: input.hidden === true,
        groupedVaults,
        groupedVaultSort: input.groupedVaultSort ?? DEFAULT_GROUPED_VAULT_SORT.mode,
        groupedVaultSortDirection:
          input.groupedVaultSortDirection ?? DEFAULT_GROUPED_VAULT_SORT.direction,
      });
      groups = [...groups, group];
      cascadeHideMembers(group);
      if (group.hidden) options.onGroupHidden?.();
      return cloneGroup(group);
    },

    async update(input: VaultGroupUpdateInput): Promise<VaultGroup> {
      assertMutable();
      const index = findIndex(input.id);
      if (index < 0) {
        throw new RpcError(VAULT_ERROR_CODES.GROUP_NOT_FOUND, `group not found: ${input.id}`);
      }
      const current = groups[index];
      const nextDisplayName =
        input.displayName !== undefined
          ? assertDisplayName(input.displayName)
          : current.displayName;
      assertGroupedVaultSort(input.groupedVaultSort);
      assertSortDirection(input.groupedVaultSortDirection);
      const nextGroupedVaults = input.groupedVaults
        ? [...input.groupedVaults]
        : [...current.groupedVaults];
      if (input.groupedVaults) {
        assertKnownVaultIds(nextGroupedVaults);
        const vaultSet = new Set(nextGroupedVaults);
        groups = groups.map((g, i) =>
          i === index
            ? g
            : {
                ...g,
                groupedVaults: g.groupedVaults.filter((m) => !vaultSet.has(m)),
              },
        );
      }
      const next = normalizeVaultGroup({
        ...current,
        displayName: nextDisplayName,
        collapsed: input.collapsed ?? current.collapsed,
        hidden: input.hidden ?? current.hidden,
        order: input.order ?? current.order,
        groupedVaults: nextGroupedVaults,
        groupedVaultSort: input.groupedVaultSort ?? current.groupedVaultSort,
        groupedVaultSortDirection:
          input.groupedVaultSortDirection ?? current.groupedVaultSortDirection,
      });
      groups = groups.map((g, i) => (i === index ? next : g));
      if (next.hidden && !current.hidden) {
        options.hideVaults?.(uniqueVaultIds(current.groupedVaults, next.groupedVaults));
        options.onGroupHidden?.();
      } else {
        cascadeHideMembers(next);
      }
      cascadeUnhideMembers(current, next);
      return cloneGroup(next);
    },

    async delete(id: string): Promise<void> {
      assertMutable();
      const index = findIndex(id);
      if (index < 0) {
        throw new RpcError(VAULT_ERROR_CODES.GROUP_NOT_FOUND, `group not found: ${id}`);
      }
      groups = groups.filter((g) => g.id !== id);
    },

    async setCollapsed(id: string, collapsed: boolean): Promise<VaultGroup> {
      return service.update({ id, collapsed });
    },

    async reorder(orders: { id: string; order: number }[]): Promise<VaultGroup[]> {
      assertMutable();
      for (const entry of orders) {
        const index = findIndex(entry.id);
        if (index < 0) {
          throw new RpcError(VAULT_ERROR_CODES.GROUP_NOT_FOUND, `group not found: ${entry.id}`);
        }
        groups[index] = { ...groups[index], order: entry.order };
      }
      return groups.map(cloneGroup);
    },

    async reorderGroupedVaults(id: string, groupedVaults: string[]): Promise<VaultGroup> {
      assertMutable();
      const index = findIndex(id);
      if (index < 0) {
        throw new RpcError(VAULT_ERROR_CODES.GROUP_NOT_FOUND, `group not found: ${id}`);
      }
      const current = groups[index].groupedVaults;
      const next = groupedVaults
        .map((vaultId) => vaultId.trim())
        .filter((vaultId) => vaultId.length > 0);
      if (!sameIdSet(current, next)) {
        throw new RpcError(
          VAULT_ERROR_CODES.GROUPS_INVALID,
          "reorder grouped_vaults must be a permutation of current membership",
        );
      }
      const updated = normalizeVaultGroup({ ...groups[index], groupedVaults: next });
      groups = groups.map((g, i) => (i === index ? updated : g));
      return cloneGroup(updated);
    },

    async repair(): Promise<void> {
      groups = [];
      invalid = false;
    },
  };

  return {
    service,
    setInvalid(next: boolean) {
      invalid = next;
    },
    reset(nextGroups?: readonly VaultGroup[]) {
      groups = cloneAll(nextGroups ?? seed);
      invalid = false;
    },
  };
}
