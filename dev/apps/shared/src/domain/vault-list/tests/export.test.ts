import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAULT_EXPORT_FORMAT,
  exportFilenameSanitizeKind,
  vaultCanExport,
  vaultExportFilename,
} from "..";
import { vaultListItemFixture } from "./fixtures";

describe("vaultExportFilename", () => {
  it("uses the display name, not a slug", () => {
    expect(vaultExportFilename("Minhas notas", "contents_zip")).toBe("Minhas notas.zip");
    expect(vaultExportFilename("Minhas notas", "seven_zip")).toBe("Minhas notas.7z");
  });

  it("trims the display name", () => {
    expect(vaultExportFilename("  Vault  ", "contents_zip")).toBe("Vault.zip");
  });

  it("replaces illegal path characters instead of dropping the name", () => {
    expect(vaultExportFilename("a/b:c", "seven_zip")).toBe("a_b_c.7z");
    expect(vaultExportFilename("Notes: 2026", "contents_zip")).toBe("Notes_ 2026.zip");
  });

  it("replaces control characters, including DEL and C1", () => {
    expect(vaultExportFilename("a\u0001b", "contents_zip")).toBe("a_b.zip");
    expect(vaultExportFilename("a\u007fb", "contents_zip")).toBe("a_b.zip");
    expect(vaultExportFilename("a\u0085b", "contents_zip")).toBe("a_b.zip");
  });

  it("falls back to vault for empty, dot and reserved names", () => {
    expect(vaultExportFilename("", "contents_zip")).toBe("vault.zip");
    expect(vaultExportFilename("..", "contents_zip")).toBe("vault.zip");
    expect(vaultExportFilename("CON", "contents_zip")).toBe("vault.zip");
  });

  it("does not throw on a lone surrogate", () => {
    expect(vaultExportFilename("Fotos \uD83D", "contents_zip")).toBe("Fotos \uD83D.zip");
  });

  it("defaults callers to a .zip of encrypted contents", () => {
    expect(
      vaultExportFilename(
        vaultListItemFixture({ displayName: "Demo" }).displayName,
        "contents_zip",
      ),
    ).toBe("Demo.zip");
  });
});

describe("vaultCanExport", () => {
  it("allows closed vaults", () => {
    expect(vaultCanExport(vaultListItemFixture({ session: null }))).toBe(true);
  });

  it("allows open vaults", () => {
    expect(
      vaultCanExport(
        vaultListItemFixture({
          storageMode: "encrypted_dir",
          session: "open",
        }),
      ),
    ).toBe(true);
  });

  it("allows upriv_plain vaults", () => {
    expect(
      vaultCanExport(vaultListItemFixture({ storageMode: "upriv_plain", session: null })),
    ).toBe(true);
  });

  it("blocks closing vaults", () => {
    expect(vaultCanExport(vaultListItemFixture({ session: "closing" }))).toBe(false);
  });

  it("blocks recovery vaults", () => {
    expect(vaultCanExport(vaultListItemFixture({ session: "recovery" }))).toBe(false);
  });

  it("blocks in-flight opening and closing pipelines", () => {
    const vault = vaultListItemFixture({ id: "a", session: null });
    expect(vaultCanExport(vault, { openingVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { closingVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { openingVaultIds: ["other"] })).toBe(true);
  });
});

describe("exportFilenameSanitizeKind", () => {
  it("is unchanged when the display name is already a safe stem", () => {
    expect(exportFilenameSanitizeKind("Notes")).toBe("unchanged");
  });

  it("is adjusted when illegal characters are replaced", () => {
    expect(exportFilenameSanitizeKind("Notes: 2026")).toBe("adjusted");
  });

  it("is fallback for empty, dot, and reserved names", () => {
    expect(exportFilenameSanitizeKind("")).toBe("fallback");
    expect(exportFilenameSanitizeKind("CON")).toBe("fallback");
  });

  it("defaults the zip format to contents_zip", () => {
    expect(DEFAULT_VAULT_EXPORT_FORMAT).toBe("contents_zip");
  });
});
