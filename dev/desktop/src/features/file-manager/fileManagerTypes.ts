import type { VaultWorkspaceState } from "./fileTreeTypes";

export type FileManagerSurface = "maximized" | "minimized";

export interface FileManagerEntry {
  vaultId: string;
  displayName: string;
  surface: FileManagerSurface;
  workspace: VaultWorkspaceState;
}
