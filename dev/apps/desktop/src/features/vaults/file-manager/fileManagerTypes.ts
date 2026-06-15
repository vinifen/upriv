import type { VaultWorkspaceState } from "./lib/fileManagerWorkspaceTypes";

export type FileManagerSurface = "maximized" | "minimized";

export interface FileManagerEntry {
  vaultId: string;
  displayName: string;
  surface: FileManagerSurface;
  workspace: VaultWorkspaceState;
}
