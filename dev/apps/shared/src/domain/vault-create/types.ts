import type { KdfUnlockPreset } from "../vault-settings/kdf";
import type { VaultSettingsConfig } from "../vault-settings";

export type CreateVaultSource = "import" | "scratch";

/** Result of reading a `.zip` central directory. `null` until the probe returns. */
export type ZipImportLayout = "store" | "files";

/** How an import draft was chosen — a backup tree is not a `.7z` archive. */
export type CreateVaultImportKind = "file" | "backup";

/** What the Import option picked. A directory's children become the vault root. */
export type CreateVaultImportShape = "file" | "directory";

export const CREATE_VAULT_STEPS = [
  "source",
  "identity",
  "password",
  "general",
  "advanced",
] as const;

export type CreateVaultStepId = (typeof CREATE_VAULT_STEPS)[number];

export type CreateVaultStepStatus = "ready" | "incomplete" | "error";

/** How the new vault joins a group — applied only on Create (not while drafting). */
export type CreateVaultGroupMode = "none" | "existing" | "create";

export type CreateVaultGroupAssignment =
  | { kind: "none" }
  | { kind: "existing"; groupId: string }
  | { kind: "create"; displayName: string };

export interface CreateVaultDraft {
  source: CreateVaultSource | null;
  /** `backup` skips 7z password/probe and copies frozen `store/`. */
  importKind: CreateVaultImportKind;
  /** `directory` copies the folder's children. `file` is one file or an archive. */
  importShape: CreateVaultImportShape;
  /**
   * Unpack an ordinary `.zip` or `.7z`. Ignored for a folder, a normal file,
   * and a Upriv store `.zip`. Defaults on.
   */
  importExtract: boolean;
  importFileName: string;
  importFilePath: string;
  /**
   * Set when a `.zip` has been examined. `store` copies ciphertext.
   * `files` wraps the documents into a new vault. `null` for scratch, `.7z`,
   * backup, or a `.zip` still being read.
   */
  zipLayout: ZipImportLayout | null;
  /** Classification refused this `.zip` (not a store copy and not documents). */
  importZipRejected: boolean;
  /**
   * The probe threw before it returned a layout. The zip stays blocked.
   * This is not a classification refusal, so Extract stays hidden.
   */
  importZipProbeFailed: boolean;
  displayName: string;
  note: string;
  password: string;
  passwordConfirm: string;
  passwordHint: string;
  passwordValidated: boolean;
  passwordTestFailed: boolean;
  /** Probe threw (SAF / missing method) — not a wrong archive password. */
  passwordProbeUnavailable: boolean;
  auto_close: VaultSettingsConfig["auto_close"];
  backup: VaultSettingsConfig["backup"];
  /** Create-time only — written to `vault.header`, not `config.toml`. */
  kdf: { unlock_preset: KdfUnlockPreset };
  /**
   * Preset already stored in an imported `vault.header`. Shown on the disabled
   * KDF list. `null` means the archive did not say, so nothing is selected.
   */
  archiveUnlockPreset: KdfUnlockPreset | null;
  storage: VaultSettingsConfig["storage"];
  mount: VaultSettingsConfig["mount"];
  security: Omit<VaultSettingsConfig["security"], "password_changed_at">;
  /** Carried from an import so create does not reset compression the form does not show. */
  seven_zip: VaultSettingsConfig["seven_zip"];
  policy: VaultSettingsConfig["policy"];
  order: number;
  hidden: boolean;
  /** Deferred group membership — applied when the vault is created. */
  groupMode: CreateVaultGroupMode;
  /** Target when `groupMode === "existing"`. */
  groupId: string;
  /** New group name when `groupMode === "create"`. */
  groupName: string;
}

export interface CreateVaultResult {
  vaultId: string;
  displayName: string;
  note: string;
  passwordHint: string;
  order: number;
  storageMode: VaultSettingsConfig["storage"]["mode"];
  settings: VaultSettingsConfig;
  /** Set when create chose unlock RAM — persisted to `vault.header` only. */
  unlockPreset?: KdfUnlockPreset;
  groupAssignment: CreateVaultGroupAssignment;
  source: CreateVaultSource;
  importKind: CreateVaultImportKind;
  importShape: CreateVaultImportShape;
  importExtract: boolean;
  zipLayout: ZipImportLayout | null;
  importFilePath?: string;
  importFileName?: string;
}
