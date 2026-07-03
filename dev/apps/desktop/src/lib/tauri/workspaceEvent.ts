import { TAURI_EVENTS } from "./commands";

export interface WorkspaceChangedEvent {
  vaultId: string;
  paths: string[];
}

export { TAURI_EVENTS };
