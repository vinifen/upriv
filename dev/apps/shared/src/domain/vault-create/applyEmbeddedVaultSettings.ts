import { normalizeWorkspaceTable } from "../workspace";
import { uniqueDisplayName } from "../vault/displayName";
import { parseKdfUnlockPreset } from "../vault-settings";
import type { KdfUnlockPreset, VaultSettingsConfig } from "../vault-settings";
import { createVaultChoosesKdf } from "../vault-settings/kdf";
import type { CreateVaultDraft } from "./types";

/** Settings read from a store zip, a backup zip, a `.7z`, or a plain-text `.zip`. */
export interface EmbeddedVaultSettings {
  settings: VaultSettingsConfig;
  unlockPreset: KdfUnlockPreset | null;
}

/** Draft as it was when the archive path was chosen, before this fill. */
export type EmbeddedSettingsSnapshot = CreateVaultDraft;

function unchanged<T>(current: T, snapshot: T, incoming: T): T {
  return JSON.stringify(current) === JSON.stringify(snapshot) ? incoming : current;
}

/**
 * Copy embedded vault settings onto a create draft.
 *
 * A field changes only when it still matches `snapshot` (the draft when the
 * file was chosen). Password and group stay. Edits made before the read
 * returns stay.
 */
export function applyEmbeddedVaultSettings(
  draft: CreateVaultDraft,
  embedded: EmbeddedVaultSettings,
  snapshot: EmbeddedSettingsSnapshot,
  existingDisplayNames: readonly string[] = [],
): CreateVaultDraft {
  const source = embedded.settings;
  const security = {
    wipe_passes: source.security.wipe_passes,
    wipe_pattern: source.security.wipe_pattern,
  };
  const next: CreateVaultDraft = {
    ...draft,
    displayName:
      draft.importKind === "backup"
        ? draft.displayName
        : unchanged(
            draft.displayName,
            snapshot.displayName,
            uniqueDisplayName(source.vault.display_name, existingDisplayNames),
          ),
    note: unchanged(draft.note, snapshot.note, source.vault.note),
    passwordHint: unchanged(draft.passwordHint, snapshot.passwordHint, source.vault.password_hint),
    hidden: unchanged(draft.hidden, snapshot.hidden, source.vault.hidden),
    order: unchanged(draft.order, snapshot.order, source.vault.order),
    storage: unchanged(draft.storage, snapshot.storage, { ...source.storage }),
    mount: unchanged(draft.mount, snapshot.mount, source.mount),
    backup: unchanged(draft.backup, snapshot.backup, { ...source.backup }),
    auto_close: unchanged(draft.auto_close, snapshot.auto_close, { ...source.auto_close }),
    security: unchanged(draft.security, snapshot.security, security),
    seven_zip: unchanged(draft.seven_zip, snapshot.seven_zip, { ...source.seven_zip }),
    file_manager: unchanged(draft.file_manager, snapshot.file_manager, { ...source.file_manager }),
    archiveUnlockPreset: embedded.unlockPreset,
  };
  if (embedded.unlockPreset && createVaultChoosesKdf(next)) {
    next.kdf = unchanged(draft.kdf, snapshot.kdf, { unlock_preset: embedded.unlockPreset });
  }
  return next;
}

/** Fields `applyEmbeddedVaultSettings` may change, besides `archiveUnlockPreset`. */
const EMBEDDED_DRAFT_FIELDS = [
  "displayName",
  "note",
  "passwordHint",
  "hidden",
  "order",
  "storage",
  "mount",
  "backup",
  "auto_close",
  "security",
  "seven_zip",
  "file_manager",
  "kdf",
] as const satisfies readonly (keyof CreateVaultDraft)[];

/**
 * Take a file's settings back out of a draft: the person turned them off, or
 * chose another file. A field goes back to `snapshot` only while it still holds
 * what `applied` put there, so an edit made since stays.
 */
export function revertEmbeddedVaultSettings(
  draft: CreateVaultDraft,
  applied: CreateVaultDraft,
  snapshot: EmbeddedSettingsSnapshot,
): CreateVaultDraft {
  const restore = <K extends (typeof EMBEDDED_DRAFT_FIELDS)[number]>(field: K) => ({
    [field]: unchanged(draft[field], applied[field], snapshot[field]),
  });
  return Object.assign(
    { ...draft, archiveUnlockPreset: null },
    ...EMBEDDED_DRAFT_FIELDS.map(restore),
  ) as CreateVaultDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/** Parse `vault_import_probe` settings. Incomplete objects are ignored. */
export function parseEmbeddedVaultSettings(
  record: Record<string, unknown>,
): EmbeddedVaultSettings | null {
  if (!isRecord(record.settings)) return null;
  const settings = record.settings;
  if (!isRecord(settings.vault) || !isRecord(settings.storage) || !isRecord(settings.mount)) {
    return null;
  }
  if (
    !isRecord(settings.backup) ||
    !isRecord(settings.security) ||
    !isRecord(settings.auto_close)
  ) {
    return null;
  }
  if (!isRecord(settings.seven_zip) || !isRecord(settings.file_manager)) return null;
  const displayName = str(settings.vault.display_name);
  const mode = oneOf(str(settings.storage.mode) ?? "", ["encrypted_dir", "upriv_plain"] as const);
  const plainFiles =
    oneOf(str(settings.storage.plain_files) ?? "", ["chosen", "whole"] as const) ?? "chosen";
  const backupMode = oneOf(str(settings.backup.mode) ?? "", ["keep_last", "keep_all"] as const);
  const wipePattern = oneOf(str(settings.security.wipe_pattern) ?? "", [
    "random",
    "zeros",
  ] as const);
  const archiveMode = oneOf(str(settings.seven_zip.archive_mode) ?? "", [
    "compress_encrypt",
    "encrypt_only",
  ] as const);
  if (!displayName || !mode || !backupMode || !wipePattern || !archiveMode) {
    return null;
  }
  const keepLast = num(settings.backup.keep_last);
  const wipePasses = num(settings.security.wipe_passes);
  const idle = num(settings.auto_close.idle_minutes);
  const compression = num(settings.seven_zip.compression_level);
  const order = num(settings.vault.order);
  if (
    keepLast === null ||
    wipePasses === null ||
    idle === null ||
    compression === null ||
    order === null
  ) {
    return null;
  }
  const enabled = bool(settings.backup.enabled);
  const skipUnchanged = bool(settings.backup.skip_unchanged);
  const hidden = bool(settings.vault.hidden);
  const autoEnabled = bool(settings.auto_close.enabled);
  const encryptNames = bool(settings.seven_zip.encrypt_file_names);
  const solid = bool(settings.seven_zip.solid);
  const confirmDelete = bool(settings.file_manager.confirm_delete);
  if (
    enabled === null ||
    skipUnchanged === null ||
    hidden === null ||
    autoEnabled === null ||
    encryptNames === null ||
    solid === null ||
    confirmDelete === null
  ) {
    return null;
  }
  const unlockRaw = str(record.unlockPreset);
  return {
    unlockPreset: unlockRaw ? parseKdfUnlockPreset(unlockRaw) : null,
    settings: {
      vault: {
        id: str(settings.vault.id) ?? "",
        display_name: displayName,
        order,
        password_hint: str(settings.vault.password_hint) ?? "",
        note: str(settings.vault.note) ?? "",
        hidden,
      },
      storage: { mode, plain_files: plainFiles },
      mount: normalizeWorkspaceTable(settings.mount, "vault"),
      backup: {
        enabled,
        mode: backupMode,
        keep_last: keepLast,
        skip_unchanged: skipUnchanged,
      },
      security: {
        wipe_passes: wipePasses,
        wipe_pattern: wipePattern,
      },
      auto_close: {
        enabled: autoEnabled,
        idle_minutes: idle,
      },
      file_manager: { confirm_delete: confirmDelete },
      seven_zip: {
        encrypt_file_names: encryptNames,
        archive_mode: archiveMode,
        compression_level: compression,
        solid,
      },
    },
  };
}
