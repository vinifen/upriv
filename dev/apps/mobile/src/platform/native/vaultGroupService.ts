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

/** Native → `upriv-ffi` `vault_group_*` (`.upriv/vault_groups.toml`). */
export const nativeVaultGroupService: VaultGroupService = {
  async list() {
    return rpcVaultGroupList();
  },
  create: (input) => {
    return rpcVaultGroupCreate(input);
  },
  update: (input) => {
    return rpcVaultGroupUpdate(input);
  },
  delete: (id) => {
    return rpcVaultGroupDelete(id);
  },
  setCollapsed: (id, collapsed) => {
    return rpcVaultGroupSetCollapsed(id, collapsed);
  },
  reorder: (orders) => {
    return rpcVaultGroupReorder(orders);
  },
  reorderGroupedVaults: (id, groupedVaults) => {
    return rpcVaultGroupReorderGroupedVaults(id, groupedVaults);
  },
  repair: () => {
    return rpcVaultGroupRepair();
  },
};
