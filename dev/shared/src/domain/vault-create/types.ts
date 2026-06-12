import type { VaultSettingsConfig } from "../vault-settings";

export type CreateVaultSource = "import" | "scratch";

export const CREATE_VAULT_STEPS = [
  "source",
  "identity",
  "password",
  "general",
  "advanced",
] as const;

export type CreateVaultStepId = (typeof CREATE_VAULT_STEPS)[number];

export type CreateVaultStepStatus = "ready" | "incomplete" | "error";

export interface CreateVaultDraft {
  source: CreateVaultSource | null;
  importFileName: string;
  importFilePath: string;
  displayName: string;
  note: string;
  password: string;
  passwordConfirm: string;
  passwordHint: string;
  passwordValidated: boolean;
  passwordTestFailed: boolean;
  auto_close: VaultSettingsConfig["auto_close"];
  backup: VaultSettingsConfig["backup"];
  seven_zip: Pick<VaultSettingsConfig["seven_zip"], "archive_mode" | "encrypt_file_names">;
  storage: VaultSettingsConfig["storage"];
  close: VaultSettingsConfig["close"];
  security: Pick<VaultSettingsConfig["security"], "mode" | "secure_wipe_workspace">;
  policy: VaultSettingsConfig["policy"];
  order: number;
  hidden: boolean;
}

export interface CreateVaultResult {
  vaultId: string;
  displayName: string;
  note: string;
  passwordHint: string;
  order: number;
  storageMode: VaultSettingsConfig["storage"]["mode"];
  settings: VaultSettingsConfig;
}
