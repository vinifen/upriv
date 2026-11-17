import {
  displayNameToVaultId,
  validateDisplayName,
  type DisplayNameValidationCode,
} from "../vault/displayName";
import {
  VAULT_BACKUP_LIST,
  VAULT_UNLOCKED_LIST,
  encryptedFolderUnchosen,
  isAbsoluteOsFilesystemPath,
  isContentUri,
  rowProblems,
  type AppUnlockedFolders,
  type DeviceGroups,
  type FolderListPolicy,
  type HereDevice,
} from "../folder-lists";
import { storageModeIsPlaintext } from "../vault/types";
import type { CreateVaultDraft, CreateVaultStepId, CreateVaultStepStatus } from "./types";
import {
  createVaultImportNeedsArchivePassword,
  createVaultSettingsLocked,
  importSetsVaultPassword,
} from "./importKind";

export type CreateVaultValidationCode =
  | DisplayNameValidationCode
  | "duplicate"
  | "source_missing"
  | "import_file_missing"
  | "import_zip_pending"
  | "import_zip_rejected"
  | "password_empty"
  | "password_mismatch"
  | "password_not_validated"
  | "password_wrong"
  | "import_probe_unavailable"
  | "group_missing"
  | "group_name_empty"
  | "group_name_too_long"
  | "group_name_invalid"
  /** A folder a row of the unlocked folder list holds, on any device, cannot be used. */
  | "unlocked_folder_row_invalid"
  /** The draft turns this vault's unlocked folder on, and this device has no folder chosen for it. */
  | "unlocked_folder_unchosen"
  /** A folder a row of the backup list holds, on any device, cannot be used. */
  | "backup_folder_row_invalid";

/** The folder lists a new vault joins, as this device sees them. */
export interface CreateVaultLists {
  /** This device; `null` while unknown. */
  here: HereDevice | null;
  /** The app's unlocked folders: what Use the app's gives the new vault on this device. */
  appUnlocked: AppUnlockedFolders;
}

/** No device known yet: no folder is missing. */
export const NO_CREATE_VAULT_LISTS: CreateVaultLists = {
  here: null,
  appUnlocked: { encrypted_vaults: false, devices: {} },
};

/**
 * True when a row of any device's group has a path the rules refuse. Core
 * writes a new vault's lists as they are, so every row is checked here, the
 * ones a carried settings file brought too.
 */
function rowsInvalid<F extends string>(
  groups: DeviceGroups<F>,
  policy: FolderListPolicy<F>,
): boolean {
  return Object.values(groups).some((group) => rowProblems(undefined, group, policy).size > 0);
}

/**
 * The draft gives the new vault an unlocked folder this device has no folder
 * for. A vault that follows the app is not one: the app's own switch and list
 * leave every such vault the same.
 */
function unlockedFolderUnchosen(draft: CreateVaultDraft, lists: CreateVaultLists): boolean {
  if (storageModeIsPlaintext(draft.storage.mode)) return false;
  return (
    encryptedFolderUnchosen(lists.appUnlocked, draft.unlocked_folder, lists.here) &&
    !encryptedFolderUnchosen(lists.appUnlocked, null, lists.here)
  );
}

/** Mock lifecycle unlock (`trim().length >= 4`). Live create and open refuse only an empty one. */
const MOCK_LIFECYCLE_PASSWORD_MIN_LENGTH = 4;

/** Mock unlock / rewrap reject this word. Live create does not. */
const MOCK_LIFECYCLE_WRONG_PASSWORD = "wrong";

/** Prototype mock unlock — still trims. Not used on live create. */
export function isMockLifecyclePasswordValid(password: string): boolean {
  const trimmed = password.trim();
  if (!trimmed) return false;
  if (trimmed.length < MOCK_LIFECYCLE_PASSWORD_MIN_LENGTH) return false;
  return trimmed !== MOCK_LIFECYCLE_WRONG_PASSWORD;
}

/**
 * Live unlock / close prompt: trim only to detect an empty field.
 * Argon2 receives the password bytes exactly as typed.
 */
export function isLifecyclePasswordPresent(password: string): boolean {
  return password.trim().length > 0;
}

function importSourcePathAccepted(draft: CreateVaultDraft): boolean {
  if (!draft.importFileName.trim()) return false;
  if (draft.importShape === "directory") {
    return isAbsoluteOsFilesystemPath(draft.importFilePath) || isContentUri(draft.importFilePath);
  }
  return isAbsoluteOsFilesystemPath(draft.importFilePath);
}

export function validateCreateVaultStep(
  stepId: CreateVaultStepId,
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  /** When set, `existing` group assignment must reference a live group id. */
  knownGroupIds: readonly string[] = [],
  lists: CreateVaultLists = NO_CREATE_VAULT_LISTS,
): CreateVaultValidationCode[] {
  switch (stepId) {
    case "source": {
      const errors: CreateVaultValidationCode[] = [];
      if (!draft.source) errors.push("source_missing");
      if (draft.source === "import") {
        if (draft.importKind === "backup") {
          if (!draft.importFilePath.trim()) errors.push("import_file_missing");
        } else if (!importSourcePathAccepted(draft)) {
          errors.push("import_file_missing");
        } else if (
          draft.importShape !== "directory" &&
          draft.importFileName.trim().toLowerCase().endsWith(".zip")
        ) {
          if (draft.importZipProbeFailed) errors.push("import_zip_rejected");
          else if (!draft.zipLayout && !draft.importZipRejected) errors.push("import_zip_pending");
          else if (draft.importZipRejected && draft.importExtract) {
            errors.push("import_zip_rejected");
          }
        }
      }
      return errors;
    }
    case "identity": {
      // The name may still come from the file, and this step's fields are locked.
      if (createVaultSettingsLocked(draft)) return [];
      const errors: CreateVaultValidationCode[] = [];
      const nameError = validateDisplayName(draft.displayName);
      if (nameError) errors.push(nameError);
      const nextId = displayNameToVaultId(draft.displayName, []);
      if (draft.displayName.trim() && existingIds.includes(nextId)) errors.push("duplicate");
      return errors;
    }
    case "password": {
      const errors: CreateVaultValidationCode[] = [];
      const password = draft.password;
      if (draft.source === "scratch" || importSetsVaultPassword(draft)) {
        if (!password.trim()) errors.push("password_empty");
        if (draft.password !== draft.passwordConfirm) errors.push("password_mismatch");
      } else if (draft.source === "import") {
        if (createVaultImportNeedsArchivePassword(draft)) {
          if (!password.trim()) errors.push("password_empty");
          if (draft.passwordProbeUnavailable) {
            errors.push("import_probe_unavailable");
          } else if (!draft.passwordValidated) {
            if (draft.passwordTestFailed) {
              if (!errors.includes("password_wrong")) errors.push("password_wrong");
            } else {
              errors.push("password_not_validated");
            }
          }
        }
      } else if (!password.trim()) {
        errors.push("password_empty");
      }
      return errors;
    }
    case "general": {
      const errors: CreateVaultValidationCode[] = [];
      if (draft.groupMode === "existing") {
        const groupId = draft.groupId.trim();
        if (!groupId || !knownGroupIds.includes(groupId)) {
          errors.push("group_missing");
        }
      }
      if (draft.groupMode === "create") {
        const nameError = validateDisplayName(draft.groupName);
        if (nameError === "empty") errors.push("group_name_empty");
        else if (nameError === "too_long") errors.push("group_name_too_long");
        else if (nameError) errors.push("group_name_invalid");
      }
      if (rowsInvalid(draft.backup.devices, VAULT_BACKUP_LIST)) {
        errors.push("backup_folder_row_invalid");
      }
      return errors;
    }
    case "advanced": {
      const errors: CreateVaultValidationCode[] = [];
      if (rowsInvalid(draft.unlocked_folder.devices, VAULT_UNLOCKED_LIST)) {
        errors.push("unlocked_folder_row_invalid");
      }
      if (unlockedFolderUnchosen(draft, lists)) errors.push("unlocked_folder_unchosen");
      return errors;
    }
    default:
      return [];
  }
}

export function validateAllCreateVaultSteps(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  knownGroupIds: readonly string[] = [],
  lists: CreateVaultLists = NO_CREATE_VAULT_LISTS,
): Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> {
  const result: Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> = {};
  for (const stepId of ["source", "identity", "password", "general", "advanced"] as const) {
    const errors = validateCreateVaultStep(stepId, draft, existingIds, knownGroupIds, lists);
    if (errors.length > 0) result[stepId] = errors;
  }
  return result;
}

export function getCreateVaultStepStatus(
  stepId: CreateVaultStepId,
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  attemptedSteps: ReadonlySet<CreateVaultStepId>,
  submitAttempted: boolean,
  knownGroupIds: readonly string[] = [],
  lists: CreateVaultLists = NO_CREATE_VAULT_LISTS,
): CreateVaultStepStatus {
  const errors = validateCreateVaultStep(stepId, draft, existingIds, knownGroupIds, lists);
  if (errors.length === 0) {
    const locks = stepId === "identity" || stepId === "general" || stepId === "advanced";
    return locks && createVaultSettingsLocked(draft) ? "waiting" : "ready";
  }
  if (submitAttempted || attemptedSteps.has(stepId)) return "error";
  return "incomplete";
}

export function canSubmitCreateVault(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  knownGroupIds: readonly string[] = [],
  lists: CreateVaultLists = NO_CREATE_VAULT_LISTS,
): boolean {
  return (
    Object.keys(validateAllCreateVaultSteps(draft, existingIds, knownGroupIds, lists)).length === 0
  );
}
