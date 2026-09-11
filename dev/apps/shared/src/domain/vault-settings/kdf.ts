/**
 * Argon2id unlock-cost presets (SECURITY-CRYPTO).
 * Chosen at vault create; stored in `vault.header` when crypto lands.
 * Labels = guessing cost + RAM to unlock — never device class.
 */

import type { I18nKey } from "../../i18n/catalog";
import type { PolicyRadioBadge } from "./policyRadioBadge";

export type KdfUnlockPreset = "32mib" | "64mib" | "128mib" | "256mib" | "1gib" | "2gib";

/** UI order: recommended → stronger → then weaker (less-secure last). */
export const KDF_UNLOCK_PRESETS = [
  "256mib",
  "1gib",
  "2gib",
  "128mib",
  "64mib",
  "32mib",
] as const satisfies readonly KdfUnlockPreset[];

/** Create-vault default (256 MiB / 3 passes). */
export const DEFAULT_KDF_UNLOCK_PRESET: KdfUnlockPreset = "256mib";

/** Argon2id `m`/`t`/`p` for a shipping preset (`p` is always 1). */
export interface KdfParams {
  memoryKib: number;
  timeCost: number;
  parallelism: 1;
}

export function kdfParamsFromPreset(preset: KdfUnlockPreset): KdfParams {
  switch (preset) {
    case "32mib":
      return { memoryKib: 32 * 1024, timeCost: 3, parallelism: 1 };
    case "64mib":
      return { memoryKib: 64 * 1024, timeCost: 3, parallelism: 1 };
    case "128mib":
      return { memoryKib: 128 * 1024, timeCost: 3, parallelism: 1 };
    case "256mib":
      return { memoryKib: 256 * 1024, timeCost: 3, parallelism: 1 };
    case "1gib":
      return { memoryKib: 1024 * 1024, timeCost: 1, parallelism: 1 };
    case "2gib":
      return { memoryKib: 2048 * 1024, timeCost: 1, parallelism: 1 };
  }
}

/**
 * Reminder lines for `vaults/<id>/config.toml` (typically after `[storage]`).
 * Unlock cost is **never** a TOML section — only in `contents/vault.header`.
 */
export const CONFIG_TOML_KDF_ANNOTATION = `# Unlock RAM (Argon2id) lives in contents/vault.header — not in config.toml.
# There is no [kdf] section here; upriv-core reads KDF params from the header.`;

/** Reminder for `vaults/<id>/config.toml` — group membership is a sibling file. */
export const CONFIG_TOML_GROUPS_ANNOTATION =
  "# Group membership is not here. If this vault is in a group, see .upriv/vault_groups.toml.";

export function normalizeKdfUnlockPreset(preset: string | undefined): KdfUnlockPreset {
  if (
    preset === "32mib" ||
    preset === "64mib" ||
    preset === "128mib" ||
    preset === "256mib" ||
    preset === "1gib" ||
    preset === "2gib"
  ) {
    return preset;
  }
  return DEFAULT_KDF_UNLOCK_PRESET;
}

function looksLikeBackupImportPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/").toLowerCase();
  return /(^|\/)backups\//.test(normalized);
}

/**
 * Scratch and `.7z` import wrap a **new** `contents/` — user picks unlock RAM.
 * A `.zip` of `contents/` already has `vault.header` — skip the picker (copy
 * ciphertext; do not rewrite KDF). Create-from-backup copies a frozen
 * `contents/` (stamp under `backups/`, often no `.zip` suffix) — same skip.
 * Product import accepts only `.zip` | `.7z` (`isVaultImportFileName`); until
 * core peeks for `vault.header` inside the zip, extension is the interim
 * format signal (SECURITY-CRYPTO import table).
 */
export function createVaultChoosesKdf(draft: {
  source: "import" | "scratch" | null;
  importFileName: string;
  importFilePath?: string;
}): boolean {
  if (draft.source !== "import") return true;
  if (looksLikeBackupImportPath(draft.importFilePath ?? "")) return false;
  const name = draft.importFileName.trim().toLowerCase();
  if (name.endsWith(".zip")) return false;
  return true;
}

const KDF_PRESET_STRENGTH: Record<KdfUnlockPreset, number> = {
  "32mib": 0,
  "64mib": 1,
  "128mib": 2,
  "256mib": 3,
  "1gib": 4,
  "2gib": 5,
};

/** True when `next` is weaker offline guessing than `current` (still allowed via rewrap). */
export function kdfPresetIsDowngrade(current: KdfUnlockPreset, next: KdfUnlockPreset): boolean {
  return KDF_PRESET_STRENGTH[next] < KDF_PRESET_STRENGTH[current];
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
  "1gib": {
    titleKey: "modal.settings.option.kdf.1gib",
    descKey: "modal.settings.option.kdf.1gib_desc",
    badge: "more-secure",
  },
  "2gib": {
    titleKey: "modal.settings.option.kdf.2gib",
    descKey: "modal.settings.option.kdf.2gib_desc",
    badge: "more-secure",
  },
};
