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
  if (typeof r.id !== "string") {
    throw new RpcError(INVALID_RESPONSE, "vault group: missing id", raw);
  }
  const group = normalizeVaultGroup({
    id: r.id,
    displayName: typeof r.displayName === "string" ? r.displayName : r.id,
    order: typeof r.order === "number" ? r.order : 0,
    collapsed: r.collapsed === true,
    groupedVaults: r.groupedVaults,
    groupedVaultSort: r.groupedVaultSort,
    groupedVaultSortDirection: r.groupedVaultSortDirection,
    hidden: r.hidden,
  });
  if (!group.id) {
    throw new RpcError(INVALID_RESPONSE, "vault group: empty id", raw);
  }
  return group;
}

/** Parse `vault_group_list` result. */
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
      typeof r.droppedDuplicateAssignments === "number" ? r.droppedDuplicateAssignments : 0,
  };
}
