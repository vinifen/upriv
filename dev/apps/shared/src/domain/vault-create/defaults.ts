import { DEFAULT_KDF_UNLOCK_PRESET, DEFAULT_SEVEN_ZIP } from "../vault-settings";
import { vaultWorkspace } from "../workspace";
import type { CreateVaultDraft } from "./types";

export function createVaultDraftEqual(a: CreateVaultDraft, b: CreateVaultDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function defaultOrderAtEnd(existingOrders: readonly number[]): number {
  if (existingOrders.length === 0) return 1;
  return Math.max(...existingOrders) + 1;
}

export function createEmptyCreateVaultDraft(existingOrders: readonly number[]): CreateVaultDraft {
  return {
    source: null,
    importKind: "file",
    importShape: "file",
    importExtract: true,
    importFileName: "",
    importFilePath: "",
    zipLayout: null,
    importZipRejected: false,
    importZipProbeFailed: false,
    displayName: "",
    note: "",
    password: "",
    passwordConfirm: "",
    passwordHint: "",
    passwordValidated: false,
    passwordTestFailed: false,
    passwordProbeUnavailable: false,
    auto_close: {
      enabled: false,
      idle_minutes: 15,
    },
    backup: {
      enabled: true,
      mode: "keep_last",
      keep_last: 1,
      skip_unchanged: true,
    },
    kdf: { unlock_preset: DEFAULT_KDF_UNLOCK_PRESET },
    archiveUnlockPreset: null,
    storage: { mode: "encrypted_dir" },
    mount: vaultWorkspace(),
    security: {
      wipe_passes: 1,
      wipe_pattern: "random",
    },
    seven_zip: { ...DEFAULT_SEVEN_ZIP },
    file_manager: { confirm_delete: true },
    order: defaultOrderAtEnd(existingOrders),
    hidden: false,
    groupMode: "none",
    groupId: "",
    groupName: "",
  };
}
