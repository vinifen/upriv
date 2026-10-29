import { describe, expect, it } from "vitest";
import en from "../../../../locales/en.json";
import ptBR from "../../../../locales/pt-BR.json";
import type { I18nKey } from "../../../i18n/catalog";
import { interpolate } from "../../../i18n/interpolate";
import type { I18nParams } from "../../../i18n/types";
import { parseWorkspaceSnapshot } from "../../file-manager/workspaceSnapshot";
import {
  buildVaultWelcomeFiles,
  isRootWelcomeReadmePath,
  vaultGetsWelcomeReadme,
  VAULT_WELCOME_README_PATH,
} from "../welcomeReadme";

function translator(catalog: Record<string, string>) {
  return (key: I18nKey, params?: I18nParams) => interpolate(catalog[key] ?? key, params);
}

const NOW = new Date("2026-10-09T20:30:00Z");

const scratch = {
  source: "scratch" as const,
  displayName: "Tax papers",
  note: "",
  unlockPreset: "1gib" as const,
};

describe("vaultGetsWelcomeReadme", () => {
  const ordinary = { source: "import" as const, importKind: "file" as const };

  it("is on for scratch and for imports of ordinary files", () => {
    expect(vaultGetsWelcomeReadme({ source: "scratch" })).toBe(true);
    expect(
      vaultGetsWelcomeReadme({ ...ordinary, importFileName: "docs.zip", zipLayout: "files" }),
    ).toBe(true);
    expect(vaultGetsWelcomeReadme({ ...ordinary, importFileName: "export.7z" })).toBe(true);
    expect(
      vaultGetsWelcomeReadme({ ...ordinary, importFileName: "Photos", importShape: "directory" }),
    ).toBe(true);
    expect(vaultGetsWelcomeReadme({ ...ordinary, importFileName: "note.pdf" })).toBe(true);
  });

  it("is off for a vault the user already had", () => {
    expect(
      vaultGetsWelcomeReadme({ ...ordinary, importFileName: "vault.zip", zipLayout: "store" }),
    ).toBe(false);
    expect(
      vaultGetsWelcomeReadme({
        source: "import",
        importKind: "backup",
        importFileName: "20261009-notes.zip",
      }),
    ).toBe(false);
    expect(
      vaultGetsWelcomeReadme({ ...ordinary, importFileName: "x.zip", importZipProbeFailed: true }),
    ).toBe(false);
    expect(vaultGetsWelcomeReadme({ source: null })).toBe(false);
  });
});

describe("isRootWelcomeReadmePath", () => {
  it("matches a root README in any case only", () => {
    expect(isRootWelcomeReadmePath("README.md")).toBe(true);
    expect(isRootWelcomeReadmePath("/readme.MD")).toBe(true);
    expect(isRootWelcomeReadmePath("docs/README.md")).toBe(false);
    expect(isRootWelcomeReadmePath("README.txt")).toBe(false);
  });
});

describe("buildVaultWelcomeFiles", () => {
  it("is skipped for a store zip import", () => {
    const ctx = { t: translator(en), locale: "en", now: NOW };
    const storeZip = {
      ...scratch,
      source: "import" as const,
      importFileName: "vault.zip",
      zipLayout: "store" as const,
    };
    expect(buildVaultWelcomeFiles(storeZip, ctx)).toBeUndefined();
    expect(buildVaultWelcomeFiles(scratch, ctx)).toBeDefined();
  });

  it("writes the vault facts in the UI language", () => {
    const welcome = buildVaultWelcomeFiles(scratch, {
      t: translator(ptBR),
      locale: "pt-BR",
      now: NOW,
    });
    expect(welcome?.readme).toContain("# Tax papers\n");
    expect(welcome?.readme).toContain(`## ${ptBR["vault.welcome_readme.about_heading"]}`);
    expect(welcome?.readme).toContain(
      `- **${ptBR["vault.welcome_readme.field.name"]}:** Tax papers`,
    );
    expect(welcome?.readme).toContain(
      `- **${ptBR["vault.welcome_readme.field.unlock_ram"]}:** 1 GiB`,
    );
    expect(welcome?.readme).toContain(`**${ptBR["modal.file_manager.markdown.preview"]}**`);
    expect(welcome?.readme).not.toContain("{read}");
    expect(welcome?.readme).not.toContain(ptBR["vault.welcome_readme.field.note"] + ":");
  });

  it("keeps user text from turning into Markdown", () => {
    const welcome = buildVaultWelcomeFiles(
      { ...scratch, displayName: "My *vault* [x]", note: "line one\nline <two>" },
      { t: translator(en), locale: "en", now: NOW },
    );
    expect(welcome?.readme).toContain("# My \\*vault\\* \\[x\\]\n");
    expect(welcome?.readme).toContain("- **Note:** line one line \\<two\\>");
  });

  it("opens the README in Read view on first open", () => {
    const welcome = buildVaultWelcomeFiles(scratch, { t: translator(en), locale: "en", now: NOW });
    const snapshot = parseWorkspaceSnapshot(welcome?.workspace ?? "");
    expect(snapshot).toEqual({
      format_version: 1,
      openTabs: [VAULT_WELCOME_README_PATH],
      activeTabPath: VAULT_WELCOME_README_PATH,
      expandedPaths: ["/"],
      selectedPath: VAULT_WELCOME_README_PATH,
      explorerCollapsed: false,
    });
  });
});
