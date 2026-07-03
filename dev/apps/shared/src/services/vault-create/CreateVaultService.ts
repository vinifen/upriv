import type { VaultSettingsConfig } from "../../domain/vault-settings";

/** Create-vault wizard platform hooks (import archive probe + disk create). */
export interface CreateVaultService {
  testImportArchivePassword(password: string): boolean;
  /** Browser dev placeholder until native file picker is wired. */
  selectImportArchiveForProbe(): { path: string; fileName: string };
  /** Scratch create — writes vault layout + first `.7z` (Tauri) or no-op (browser mock). */
  createVault(settings: VaultSettingsConfig, password: string): Promise<void>;
}
