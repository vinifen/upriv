import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";
import {
  serializeWorkspaceSnapshot,
  WORKSPACE_SNAPSHOT_FORMAT_VERSION,
} from "../file-manager/workspaceSnapshot";
import { DEFAULT_KDF_UNLOCK_PRESET, kdfParamsFromPreset } from "../vault-settings/kdf";
import type { KdfUnlockPreset } from "../vault-settings/kdf";
import { createVaultImportPackageKind, type ImportDecision } from "./importKind";
import type { CreateVaultResult } from "./types";

/** Same logical path as core `WELCOME_README_LOGICAL_PATH`. */
export const VAULT_WELCOME_README_PATH = "/README.md";

/** Same rule as core: any-case `README.md` at the root means the vault already has one. */
export function isRootWelcomeReadmePath(logicalPath: string): boolean {
  return (
    logicalPath.replace(/^\/+/, "").toLowerCase() ===
    VAULT_WELCOME_README_PATH.slice(1).toLowerCase()
  );
}

/** Wire payload for `vault_create` — sealed into the new `store/` by core. */
export interface VaultWelcomeFiles {
  readme: string;
  /** `.upriv-workspace.json` that opens the README in Read view on first open. */
  workspace: string;
}

export interface VaultWelcomeContext {
  t: (key: I18nKey, params?: I18nParams) => string;
  locale: string;
  now?: Date;
}

/** One line of user text inside Markdown: no line breaks, no syntax. */
function inlineMarkdownText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>|~#]/g, "\\$&");
}

function unlockRamLabel(preset: KdfUnlockPreset): string {
  const { memoryKib } = kdfParamsFromPreset(preset);
  return memoryKib >= 1024 * 1024 ? `${memoryKib / (1024 * 1024)} GiB` : `${memoryKib / 1024} MiB`;
}

function createdLabel(now: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(now);
  } catch {
    return now.toISOString();
  }
}

/**
 * A new vault gets a welcome note: scratch, or an import of ordinary files
 * (documents `.zip`, `.7z`, a folder, one file). A Upriv vault `.zip` or a
 * backup is a vault the user already had, so it never gets one. Core also
 * skips the note when the imported root already has a `README.md`.
 */
export function vaultGetsWelcomeReadme(result: ImportDecision): boolean {
  if (result.source === "scratch") return true;
  if (result.source !== "import") return false;
  try {
    return createVaultImportPackageKind(result) !== "store_zip";
  } catch {
    return false;
  }
}

/**
 * Welcome note in the UI language. Every sentence comes from `locales/*.json`,
 * so a new locale needs no code. `undefined` when this create gets no note.
 */
export function buildVaultWelcomeFiles(
  result: ImportDecision & Pick<CreateVaultResult, "displayName" | "note" | "unlockPreset">,
  { t, locale, now = new Date() }: VaultWelcomeContext,
): VaultWelcomeFiles | undefined {
  if (!vaultGetsWelcomeReadme(result)) return undefined;

  const field = (key: I18nKey, value: string) => `- **${t(key)}:** ${value}`;
  const note = inlineMarkdownText(result.note);
  const lines = [
    `# ${inlineMarkdownText(result.displayName)}`,
    "",
    t("vault.welcome_readme.intro"),
    "",
    `## ${t("vault.welcome_readme.about_heading")}`,
    "",
    field("vault.welcome_readme.field.name", inlineMarkdownText(result.displayName)),
    field("vault.welcome_readme.field.created", createdLabel(now, locale)),
    field(
      "vault.welcome_readme.field.unlock_ram",
      unlockRamLabel(result.unlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET),
    ),
    ...(note ? [field("vault.welcome_readme.field.note", note)] : []),
    "",
    `## ${t("vault.welcome_readme.tips_heading")}`,
    "",
    `- ${t("vault.welcome_readme.tip.encrypted")}`,
    `- ${t("vault.welcome_readme.tip.close")}`,
    `- ${t("vault.welcome_readme.tip.password")}`,
    `- ${t("vault.welcome_readme.tip.hint")}`,
    "",
    "---",
    "",
    t("vault.welcome_readme.footer", {
      read: `**${t("modal.file_manager.markdown.preview")}**`,
      code: `**${t("modal.file_manager.markdown.source")}**`,
    }),
    "",
  ];

  return {
    readme: lines.join("\n"),
    workspace: serializeWorkspaceSnapshot({
      format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
      openTabs: [VAULT_WELCOME_README_PATH],
      activeTabPath: VAULT_WELCOME_README_PATH,
      expandedPaths: ["/"],
      selectedPath: VAULT_WELCOME_README_PATH,
      explorerCollapsed: false,
      explorerSearchOpen: false,
      explorerSearchQuery: "",
    }),
  };
}
