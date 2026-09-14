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

/** Desktop → daemon `vault_group_*` (`.upriv/vault_groups.toml`). */
export const desktopVaultGroupService: VaultGroupService = {
  list: () => rpcVaultGroupList(),
  create: (input) => rpcVaultGroupCreate(input),
  update: (input) => rpcVaultGroupUpdate(input),
  delete: (id) => rpcVaultGroupDelete(id),
  setCollapsed: (id, collapsed) => rpcVaultGroupSetCollapsed(id, collapsed),
  reorder: (orders) => rpcVaultGroupReorder(orders),
  reorderGroupedVaults: (id, groupedVaults) => rpcVaultGroupReorderGroupedVaults(id, groupedVaults),
  repair: () => rpcVaultGroupRepair(),
};
