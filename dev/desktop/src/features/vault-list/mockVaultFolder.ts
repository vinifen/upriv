import { MOCK_UPRIV_ROOT_PATH } from "@/features/app-settings/mockAppSettings";
import type { VaultRow } from "@/types";

/** Virtual mount path shown in mock until Tauri opens the OS file manager. */
export function mockVaultWorkspacePath(vault: Pick<VaultRow, "displayName">): string {
  return `${MOCK_UPRIV_ROOT_PATH}/workspace/${vault.displayName}`;
}
