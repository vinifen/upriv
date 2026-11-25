/**
 * Argon2id unlock-cost presets (SECURITY-CRYPTO).
 * Chosen at vault create; stored in `store/header/vault.header`.
 * Labels = guessing cost + RAM to unlock — never device class.
 */

import type { I18nKey } from "../../i18n/catalog";
import type { PolicyRadioBadge } from "./policyRadioBadge";

export type KdfUnlockPreset =
  | "32mib"
  | "64mib"
  | "128mib"
  | "256mib"
  | "512mib"
  | "1gib"
  | "1536mib"
  | "2gib"
  | "3gib"
  | "4gib";

/** Every preset, from the least RAM to the most (core `KdfUnlockPreset::ALL`). */
export const KDF_UNLOCK_PRESETS = [
  "32mib",
  "64mib",
  "128mib",
  "256mib",
  "512mib",
  "1gib",
  "1536mib",
  "2gib",
  "3gib",
  "4gib",
] as const satisfies readonly KdfUnlockPreset[];

/** The presets the RAM choice shows as radios; the rest sit in its Other list. */
export const KDF_UNLOCK_MAIN_PRESETS = [
  "128mib",
  "256mib",
  "1gib",
] as const satisfies readonly KdfUnlockPreset[];

/** The Other list of the RAM choice, from the least RAM to the most. */
export const KDF_UNLOCK_OTHER_PRESETS: readonly KdfUnlockPreset[] = KDF_UNLOCK_PRESETS.filter(
  (preset) => !(KDF_UNLOCK_MAIN_PRESETS as readonly KdfUnlockPreset[]).includes(preset),
);

/** True when `preset` sits in the Other list, not among the radios. */
export function kdfPresetIsOther(preset: KdfUnlockPreset): boolean {
  return KDF_UNLOCK_OTHER_PRESETS.includes(preset);
}

/** The Other list's pick when nothing there was chosen yet: the step above the default. */
export const DEFAULT_KDF_OTHER_PRESET: KdfUnlockPreset = "512mib";

/** Create-vault default (256 MiB / 3 passes). */
export const DEFAULT_KDF_UNLOCK_PRESET: KdfUnlockPreset = "256mib";

/** Argon2id `m`/`t`/`p` for a shipping preset (`p` is always 1). */
export interface KdfParams {
  memoryKib: number;
  timeCost: number;
  parallelism: 1;
}

/** MiB of RAM each preset takes to unlock. */
const KDF_PRESET_MIB: Record<KdfUnlockPreset, number> = {
  "32mib": 32,
  "64mib": 64,
  "128mib": 128,
  "256mib": 256,
  "512mib": 512,
  "1gib": 1024,
  "1536mib": 1536,
  "2gib": 2048,
  "3gib": 3072,
  "4gib": 4096,
};

/** Passes over the memory: 3 up to 256 MiB, 2 at 512 MiB, 1 from 1 GiB (core `time_cost`). */
function kdfTimeCost(mib: number): number {
  if (mib <= 256) return 3;
  if (mib <= 512) return 2;
  return 1;
}

export function kdfParamsFromPreset(preset: KdfUnlockPreset): KdfParams {
  const mib = KDF_PRESET_MIB[preset];
  return { memoryKib: mib * 1024, timeCost: kdfTimeCost(mib), parallelism: 1 };
}

/**
 * Reminder lines for `vaults/<id>/config.toml` (typically after `[storage]`).
 * Unlock cost is **never** a TOML section — only in `store/header/vault.header`.
 */
export const CONFIG_TOML_KDF_ANNOTATION = `# Unlock RAM (Argon2id) lives in store/header/vault.header — not in config.toml.
# There is no [kdf] section here; upriv-core reads KDF params from the header.`;

/** Reminder for `vaults/<id>/config.toml` — group membership is a sibling file. */
export const CONFIG_TOML_GROUPS_ANNOTATION =
  "# Group membership is not here. If this vault is in a group, see .upriv/vault_groups.toml.";

/** Known shipping slug, or `null` — never coerce a typo to 256 MiB. */
export function parseKdfUnlockPreset(preset: string): KdfUnlockPreset | null {
  return (KDF_UNLOCK_PRESETS as readonly string[]).includes(preset)
    ? (preset as KdfUnlockPreset)
    : null;
}

/** UI form default when the field is empty. Wire parse must use `parseKdfUnlockPreset`. */
export function normalizeKdfUnlockPreset(preset: string | undefined): KdfUnlockPreset {
  const trimmed = preset?.trim();
  if (!trimmed) return DEFAULT_KDF_UNLOCK_PRESET;
  return parseKdfUnlockPreset(trimmed) ?? DEFAULT_KDF_UNLOCK_PRESET;
}

/**
 * True when the create makes a **new** `store/`, so the person chooses what
 * it is sealed with: the unlock RAM and the storage value. Scratch, a
 * documents `.zip`, and a `.7z` import make one. A Upriv `.zip` and
 * create-from-backup (`importKind: "backup"`) copy a store as it is, which
 * keeps the unlock RAM of its header and the storage value of its index, so
 * both show locked. A folder named `backups` is not that copy. A `.zip` whose
 * layout is still unknown stays locked, so a default is not shown as chosen.
 * Extract off stores that `.zip` as one file, in a new store.
 */
export function createVaultChoosesStoreSettings(draft: {
  source: "import" | "scratch" | null;
  importFileName: string;
  /** Present on drafts. A directory named `backups` does not hide the picker. */
  importFilePath?: string;
  importKind?: "file" | "backup";
  importShape?: "file" | "directory";
  importExtract?: boolean;
  zipLayout?: "store" | "files" | null;
}): boolean {
  if (draft.source !== "import") return true;
  if (draft.importKind === "backup") return false;
  if (draft.importShape === "directory") return true;
  const name = draft.importFileName.trim().toLowerCase();
  if (name.endsWith(".zip")) {
    if (draft.zipLayout === "store") return false;
    if (draft.importExtract === false) return true;
    return draft.zipLayout === "files";
  }
  return true;
}

/** True when `next` is weaker offline guessing than `current` (an unlock-RAM change still allows it). */
export function kdfPresetIsDowngrade(current: KdfUnlockPreset, next: KdfUnlockPreset): boolean {
  return KDF_PRESET_MIB[next] < KDF_PRESET_MIB[current];
}

export interface KdfUnlockOptionMeta {
  titleKey: I18nKey;
  descKey: I18nKey;
  badge?: PolicyRadioBadge;
  tone?: "default" | "less-secure";
}

/**
 * Unlock-cost labels + badges. A complete `Record` fails the typecheck when a
 * preset is added without copy — same guarantee as a desktop `switch` on keys.
 */
export const KDF_UNLOCK_OPTION_META: Record<KdfUnlockPreset, KdfUnlockOptionMeta> = {
  "32mib": {
    titleKey: "modal.settings.option.kdf.32mib",
    descKey: "modal.settings.option.kdf.32mib_desc",
    badge: "less-secure",
    tone: "less-secure",
  },
  "64mib": {
    titleKey: "modal.settings.option.kdf.64mib",
    descKey: "modal.settings.option.kdf.64mib_desc",
    badge: "less-secure",
    tone: "less-secure",
  },
  "128mib": {
    titleKey: "modal.settings.option.kdf.128mib",
    descKey: "modal.settings.option.kdf.128mib_desc",
  },
  "256mib": {
    titleKey: "modal.settings.option.kdf.256mib",
    descKey: "modal.settings.option.kdf.256mib_desc",
    badge: "recommended",
  },
  "512mib": {
    titleKey: "modal.settings.option.kdf.512mib",
    descKey: "modal.settings.option.kdf.512mib_desc",
  },
  "1gib": {
    titleKey: "modal.settings.option.kdf.1gib",
    descKey: "modal.settings.option.kdf.1gib_desc",
    badge: "more-secure",
  },
  "1536mib": {
    titleKey: "modal.settings.option.kdf.1536mib",
    descKey: "modal.settings.option.kdf.1536mib_desc",
    badge: "more-secure",
  },
  "2gib": {
    titleKey: "modal.settings.option.kdf.2gib",
    descKey: "modal.settings.option.kdf.2gib_desc",
    badge: "more-secure",
  },
  "3gib": {
    titleKey: "modal.settings.option.kdf.3gib",
    descKey: "modal.settings.option.kdf.3gib_desc",
    badge: "more-secure",
  },
  "4gib": {
    titleKey: "modal.settings.option.kdf.4gib",
    descKey: "modal.settings.option.kdf.4gib_desc",
    badge: "more-secure",
  },
};
