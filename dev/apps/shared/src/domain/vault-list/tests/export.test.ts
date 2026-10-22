import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAULT_EXPORT_FORMAT,
  exportFilenameSanitizeKind,
  vaultCanExport,
  vaultExportFilename,
  vaultExportMenuShown,
  vaultExportPending,
  vaultExportSavedAs,
} from "..";
import { vaultListItemFixture } from "./fixtures";

describe("vaultExportPending", () => {
  it("asks for the folder the file goes into", () => {
    expect(vaultExportPending("store_zip", null, "")).toBe("folder");
    expect(vaultExportPending("store_zip", "  ", "")).toBe("folder");
    expect(vaultExportPending("store_zip", "Downloads", "")).toBe("folder_not_absolute");
    expect(vaultExportPending("store_zip", " /media/usb ", "")).toBeNull();
    expect(vaultExportPending("store_zip", "E:\\Copies", "")).toBeNull();
  });

  it("takes a picked phone folder", () => {
    expect(
      vaultExportPending(
        "store_zip",
        "content://com.android.externalstorage.documents/tree/primary%3ADownload",
        "",
      ),
    ).toBeNull();
  });

  it("asks a .7z for its password before its folder", () => {
    expect(vaultExportPending("seven_zip", null, "")).toBe("password");
    expect(vaultExportPending("seven_zip", "/media/usb", "   ")).toBe("password");
    expect(vaultExportPending("seven_zip", null, "vault password")).toBe("folder");
    expect(vaultExportPending("seven_zip", "/media/usb", " spaced ")).toBeNull();
  });
});

describe("vaultExportFilename", () => {
  it("uses the display name, not a slug", () => {
    expect(vaultExportFilename("Minhas notas", "store_zip")).toBe("Minhas notas.zip");
    expect(vaultExportFilename("Minhas notas", "seven_zip")).toBe("Minhas notas.7z");
  });

  it("trims the display name", () => {
    expect(vaultExportFilename("  Vault  ", "store_zip")).toBe("Vault.zip");
  });

  it("collapses extra spaces in the display name", () => {
    expect(vaultExportFilename("My    notes", "store_zip")).toBe("My notes.zip");
  });

  it("adds the number core gives a taken name", () => {
    expect(vaultExportFilename("My notes", "store_zip", 1)).toBe("My notes.zip");
    expect(vaultExportFilename("My notes", "store_zip", 2)).toBe("My notes 2.zip");
    expect(vaultExportFilename("My notes", "seven_zip", 12)).toBe("My notes 12.7z");
  });
});

describe("vaultExportSavedAs", () => {
  it("is null while the export kept its own name", () => {
    expect(vaultExportSavedAs("My notes", "store_zip", "/media/usb/My notes.zip")).toBeNull();
    expect(vaultExportSavedAs("My notes", "seven_zip", "E:\\Copies\\My notes.7z")).toBeNull();
  });

  it("names the numbered file core saved instead", () => {
    expect(vaultExportSavedAs("My notes", "store_zip", "/media/usb/My notes 2.zip")).toBe(
      "My notes 2.zip",
    );
    expect(vaultExportSavedAs("My notes", "seven_zip", "/upriv-saf-export/My notes 3.7z")).toBe(
      "My notes 3.7z",
    );
  });

  it("replaces illegal path characters instead of dropping the name", () => {
    expect(vaultExportFilename("a/b:c", "seven_zip")).toBe("a_b_c.7z");
    expect(vaultExportFilename("Notes: 2026", "store_zip")).toBe("Notes_ 2026.zip");
  });

  it("replaces control characters, including DEL and C1", () => {
    expect(vaultExportFilename("a\u0001b", "store_zip")).toBe("a_b.zip");
    expect(vaultExportFilename("a\u007fb", "store_zip")).toBe("a_b.zip");
    expect(vaultExportFilename("a\u0085b", "store_zip")).toBe("a_b.zip");
  });

  it("falls back to vault for empty, dot and reserved names", () => {
    expect(vaultExportFilename("", "store_zip")).toBe("vault.zip");
    expect(vaultExportFilename("..", "store_zip")).toBe("vault.zip");
    expect(vaultExportFilename("CON", "store_zip")).toBe("vault.zip");
  });

  it("does not throw on a lone surrogate", () => {
    expect(vaultExportFilename("Fotos \uD83D", "store_zip")).toBe("Fotos \uD83D.zip");
  });

  it("defaults callers to a .zip of the encrypted vault", () => {
    expect(
      vaultExportFilename(vaultListItemFixture({ displayName: "Demo" }).displayName, "store_zip"),
    ).toBe("Demo.zip");
  });
});

describe("vaultCanExport", () => {
  it("allows closed vaults", () => {
    expect(vaultCanExport(vaultListItemFixture({ session: null }))).toBe(true);
  });

  it("refuses open vaults", () => {
    expect(
      vaultCanExport(
        vaultListItemFixture({
          storageMode: "encrypted_dir",
          session: "open",
        }),
      ),
    ).toBe(false);
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

  it("blocks in-flight opening, closing, creating, and queued pipelines", () => {
    const vault = vaultListItemFixture({ id: "a", session: null });
    expect(vaultCanExport(vault, { openingVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { closingVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { creatingVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { queuedVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { openingVaultIds: ["other"] })).toBe(true);
  });

  it("blocks export, password change, and unlock-RAM change", () => {
    const vault = vaultListItemFixture({ id: "a", session: null });
    expect(vaultCanExport(vault, { exportingVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { passwordChangeVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { kdfChangeVaultIds: ["a"] })).toBe(false);
    expect(vaultCanExport(vault, { exportingVaultIds: ["other"] })).toBe(true);
  });
});

describe("vaultExportMenuShown", () => {
  it("lists Export while this vault exports, so the menu reopens that export", () => {
    const vault = vaultListItemFixture({ id: "a", session: null });
    expect(vaultExportMenuShown(vault, { exportingVaultIds: ["a"] })).toBe(true);
  });

  it("follows vaultCanExport otherwise", () => {
    const closed = vaultListItemFixture({ id: "a", session: null });
    expect(vaultExportMenuShown(closed)).toBe(true);
    expect(vaultExportMenuShown(closed, { exportingVaultIds: ["other"] })).toBe(true);
    expect(vaultExportMenuShown(closed, { backupJobVaultIds: ["a"] })).toBe(false);
    expect(vaultExportMenuShown(closed, { dataFolderExporting: true })).toBe(false);
    expect(vaultExportMenuShown(vaultListItemFixture({ id: "a", session: "open" }))).toBe(false);
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

  it("defaults the zip format to store_zip", () => {
    expect(DEFAULT_VAULT_EXPORT_FORMAT).toBe("store_zip");
  });
});
