import { DEFAULT_KDF_UNLOCK_PRESET } from "../vault-settings";
import { WORKSPACE_PATH_DEFAULT } from "../workspace";
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
    importFileName: "",
    importFilePath: "",
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
      warn_before_seconds: 60,
      close_on_app_exit: false,
    },
    backup: {
      enabled: true,
      mode: "keep_last",
      keep_last: 1,
    },
    kdf: { unlock_preset: DEFAULT_KDF_UNLOCK_PRESET },
    storage: { mode: "encrypted_dir" },
    mount: { workspace_path: WORKSPACE_PATH_DEFAULT },
    security: {
      mode: "session_ram",
      secure_wipe_workspace: true,
    },
    policy: {
      allow_external_editors: false,
      disallow_copy_outside_mount: true,
      require_unmount_on_sleep: true,
    },
    order: defaultOrderAtEnd(existingOrders),
    hidden: false,
    groupMode: "none",
    groupId: "",
    groupName: "",
  };
}
