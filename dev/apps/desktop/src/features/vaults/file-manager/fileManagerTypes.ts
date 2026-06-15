import type { VaultWorkspaceState } from "./lib/fileTreeTypes";

export type FileManagerSurface = "maximized" | "minimized";

export interface FileManagerEntry {
  vaultId: string;
  displayName: string;
  surface: FileManagerSurface;
  workspace: VaultWorkspaceState;
}
