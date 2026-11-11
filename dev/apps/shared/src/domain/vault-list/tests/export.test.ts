import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAULT_EXPORT_FORMAT,
  exportFilenameSanitizeKind,
  parseVaultExportResult,
  vaultCanExport,
  vaultExportFilename,
  vaultExportMenuShown,
  vaultExportPending,
  vaultExportToast,
} from "..";
import {
  vaultExportSavedAs,
  vaultExportUnreadableNames,
  vaultFolderName,
  VAULT_EXPORT_UNREADABLE_TOAST_MS,
} from "../export";
import { vaultListItemFixture } from "./fixtures";

/** Key and params, so a test reads what the toast would say without a catalog. */
const tr = (key: string, params?: Record<string, string>) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`
    : key;

describe("parseVaultExportResult", () => {
  it("reads the file and the files kept with zeros", () => {
    expect(
      parseVaultExportResult({ path: "/out/Notes.7z", size: 9, unreadable: ["/a.txt", 3] }),
    ).toEqual({ path: "/out/Notes.7z", size: 9, unreadable: ["/a.txt"] });
  });

  it("treats a missing list as none, and refuses an answer without its file", () => {
    expect(parseVaultExportResult({ path: "/out/Notes.zip", size: 9 })).toEqual({
      path: "/out/Notes.zip",
      size: 9,
      unreadable: [],
    });
    expect(parseVaultExportResult({ size: 9 })).toBeNull();
    expect(parseVaultExportResult(null)).toBeNull();
  });
});

describe("vaultExportUnreadableNames", () => {
  it("lists file names, then an ellipsis past three", () => {
    expect(vaultExportUnreadableNames(["/docs/a.txt", "/b.pdf"])).toBe("a.txt, b.pdf");
    expect(vaultExportUnreadableNames(["/a", "/b", "/c", "/d/e"])).toBe("a, b, c, …");
  });
});

describe("vaultExportToast", () => {
  const target = { displayName: "My notes", format: "seven_zip" as const };

  it("names the saved file at the usual length when every file read", () => {
    const toast = vaultExportToast(
      target,
      { path: "/out/My notes-sevenzip.7z", size: 1, unreadable: [] },
      tr,
    );
    expect(toast).toEqual({ message: "vault.export.success(name=My notes)", durationMs: null });
  });

  it("adds the files kept with zeros and stays longer", () => {
    const toast = vaultExportToast(
      target,
      { path: "/out/My notes-sevenzip-2.7z", size: 1, unreadable: ["/docs/gone.pdf"] },
      tr,
    );
    expect(toast.message).toBe(
      "vault.export.success_numbered(filename=My notes-sevenzip.7z,name=My notes," +
        "saved=My notes-sevenzip-2.7z) vault.export.kept_unreadable(count=1,names=gone.pdf)",
    );
    expect(toast.durationMs).toBe(VAULT_EXPORT_UNREADABLE_TOAST_MS);
  });
});

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

  it("asks a plain-text .zip for the vault password before its folder", () => {
    expect(vaultExportPending("plain_zip", null, "")).toBe("password");
    expect(vaultExportPending("plain_zip", null, "secret")).toBe("folder");
    expect(vaultExportPending("plain_zip", "/media/usb", "secret")).toBeNull();
  });

  it("asks a .7z for its password before its folder", () => {
    expect(vaultExportPending("seven_zip", null, "")).toBe("password");
    expect(vaultExportPending("seven_zip", "/media/usb", "   ")).toBe("password");
    expect(vaultExportPending("seven_zip", null, "vault password")).toBe("folder");
    expect(vaultExportPending("seven_zip", "/media/usb", " spaced ")).toBeNull();
  });
});

describe("vaultExportFilename", () => {
  it("uses the display name, not a slug, and says what the file holds", () => {
    expect(vaultExportFilename("Minhas notas", "store_zip")).toBe("Minhas notas-upriv.zip");
    expect(vaultExportFilename("Minhas notas", "seven_zip")).toBe("Minhas notas-sevenzip.7z");
    expect(vaultExportFilename("Minhas notas", "plain_zip")).toBe("Minhas notas-plain-text.zip");
  });

  it("trims the display name", () => {
    expect(vaultExportFilename("  Vault  ", "store_zip")).toBe("Vault-upriv.zip");
  });

  it("collapses extra spaces in the display name", () => {
    expect(vaultExportFilename("My    notes", "store_zip")).toBe("My notes-upriv.zip");
  });

  it("adds the number core gives a taken name", () => {
    expect(vaultExportFilename("My notes", "store_zip", 1)).toBe("My notes-upriv.zip");
    expect(vaultExportFilename("My notes", "store_zip", 2)).toBe("My notes-upriv-2.zip");
    expect(vaultExportFilename("My notes", "plain_zip", 2)).toBe("My notes-plain-text-2.zip");
    expect(vaultExportFilename("My notes", "seven_zip", 12)).toBe("My notes-sevenzip-12.7z");
  });
});

describe("vaultExportSavedAs", () => {
  it("is null while the export kept its own name", () => {
    expect(vaultExportSavedAs("My notes", "store_zip", "/media/usb/My notes-upriv.zip")).toBeNull();
    expect(
      vaultExportSavedAs("My notes", "seven_zip", "E:\\Copies\\My notes-sevenzip.7z"),
    ).toBeNull();
  });

  it("names the numbered file core saved instead", () => {
    expect(vaultExportSavedAs("My notes", "store_zip", "/media/usb/My notes-upriv-2.zip")).toBe(
      "My notes-upriv-2.zip",
    );
    expect(
      vaultExportSavedAs("My notes", "seven_zip", "/upriv-saf-export/My notes-sevenzip-3.7z"),
    ).toBe("My notes-sevenzip-3.7z");
  });

  it("replaces illegal path characters instead of dropping the name", () => {
    expect(vaultExportFilename("a/b:c", "seven_zip")).toBe("a_b_c-sevenzip.7z");
    expect(vaultExportFilename("Notes: 2026", "store_zip")).toBe("Notes_ 2026-upriv.zip");
  });

  it("replaces control characters, including DEL and C1", () => {
    expect(vaultFolderName("a\u0001b")).toBe("a_b");
    expect(vaultFolderName("a\u007fb")).toBe("a_b");
    expect(vaultFolderName("a\u0085b")).toBe("a_b");
  });

  it("falls back to vault for empty, dot and reserved names", () => {
    expect(vaultFolderName("")).toBe("vault");
    expect(vaultFolderName("..")).toBe("vault");
    expect(vaultExportFilename("CON", "store_zip")).toBe("vault-upriv.zip");
  });

  it("does not throw on a lone surrogate", () => {
    expect(vaultFolderName("Fotos \uD83D")).toBe("Fotos \uD83D");
  });

  it("defaults callers to a .zip of the encrypted vault", () => {
    expect(
      vaultExportFilename(vaultListItemFixture({ displayName: "Demo" }).displayName, "store_zip"),
    ).toBe("Demo-upriv.zip");
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
