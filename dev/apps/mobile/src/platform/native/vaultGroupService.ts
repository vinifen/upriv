import type { VaultGroupService } from "@upriv/shared";
import {
  rpcVaultGroupCreate,
  rpcVaultGroupDelete,
  rpcVaultGroupList,
  rpcVaultGroupReorder,
  rpcVaultGroupReorderGroupedVaults,
  rpcVaultGroupRepair,
  rpcVaultGroupSetCollapsed,
  rpcVaultGroupUpdate,
} from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable, safVaultPathRpcUnavailable } from "./safVaultRpcGuard";

/** Native → `upriv-ffi` `vault_group_*` (`.upriv/vault_groups.toml`). */
export const nativeVaultGroupService: VaultGroupService = {
  async list() {
    if (safVaultPathRpcUnavailable()) return { groups: [], invalid: false };
    return rpcVaultGroupList();
  },
  create: (input) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupCreate(input);
  },
  update: (input) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupUpdate(input);
  },
  delete: (id) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupDelete(id);
  },
  setCollapsed: (id, collapsed) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupSetCollapsed(id, collapsed);
  },
  reorder: (orders) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupReorder(orders);
  },
  reorderGroupedVaults: (id, groupedVaults) => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupReorderGroupedVaults(id, groupedVaults);
  },
  repair: () => {
    assertSafVaultPathRpcAvailable();
    return rpcVaultGroupRepair();
  },
};
