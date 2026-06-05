import type { CreateVaultDraft } from "./createVaultTypes";

export function defaultOrderAtEnd(existingOrders: readonly number[]): number {
  if (existingOrders.length === 0) return 1;
  return Math.max(...existingOrders) + 1;
}

export function createEmptyDraft(existingOrders: readonly number[]): CreateVaultDraft {
  return {
    source: null,
    importFileName: "",
    importFilePath: "",
    displayName: "",
    note: "",
    password: "",
    passwordConfirm: "",
    passwordHint: "",
    passwordValidated: false,
    passwordTestFailed: false,
    showPassword: false,
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
    seven_zip: {
      archive_mode: "encrypt_only",
      encrypt_file_names: true,
    },
    storage: { mode: "encrypted_dir" },
    close: { default_action: "close" },
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
  };
}
