import { RpcError } from "../core-rpc/errors";
import { normalizeVaultGroup } from "./normalize";
import type { VaultGroup, VaultGroupListResult } from "./types";

const INVALID_RESPONSE = "invalid_response";

/** Parse one `vault_group_*` wire object. Shared by desktop and mobile RPC. */
export function parseVaultGroupWire(raw: unknown): VaultGroup {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, "vault group: expected object", raw);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.displayName !== "string") {
    throw new RpcError(INVALID_RESPONSE, "vault group: missing id/displayName", raw);
  }
  const group = normalizeVaultGroup({
    id: r.id,
    displayName: r.displayName,
    order: typeof r.order === "number" ? r.order : 0,
    collapsed: r.collapsed === true,
    groupedVaults: r.groupedVaults,
    members: r.members,
    groupedVaultSort: r.groupedVaultSort,
    memberSort: r.memberSort,
    groupedVaultSortDirection: r.groupedVaultSortDirection,
    memberSortDirection: r.memberSortDirection,
  });
  if (!group.id) {
    throw new RpcError(INVALID_RESPONSE, "vault group: empty id", raw);
  }
  return group;
}

/** Parse `vault_group_list` result, including legacy `droppedDuplicateMemberships`. */
export function parseVaultGroupListResult(raw: unknown): VaultGroupListResult {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, "vault_group_list: expected object", raw);
  }
  const r = raw as Record<string, unknown>;
  const groups = Array.isArray(r.groups) ? r.groups.map(parseVaultGroupWire) : [];
  return {
    groups,
    invalid: r.invalid === true,
    droppedOrphans: typeof r.droppedOrphans === "number" ? r.droppedOrphans : 0,
    droppedDuplicateAssignments:
      typeof r.droppedDuplicateAssignments === "number"
        ? r.droppedDuplicateAssignments
        : typeof r.droppedDuplicateMemberships === "number"
          ? r.droppedDuplicateMemberships
          : 0,
  };
}
