import { describe, expect, it } from "vitest";
import { vaultRootContentorPath, vaultRootLogsDisplayPath, vaultStoreDisplayPaths } from "../paths";

describe("vaultRootContentorPath", () => {
  it("uses found rootPath (vault-root, not .upriv)", () => {
    expect(
      vaultRootContentorPath(
        { status: "found", rootPath: "/data", source: "default_root" },
        "/mock",
      ),
    ).toBe("/data");
  });

  it("falls back when resolve is not found", () => {
    expect(
      vaultRootContentorPath(
        {
          status: "needs_setup",
          aliasPath: "/home/.upriv-root",
          defaultRootAnchor: "/home",
          distribution: "dev",
        },
        "/mock",
      ),
    ).toBe("/mock");
  });
});

describe("vaultStoreDisplayPaths", () => {
  it("joins POSIX vault-root as {root}/.upriv/vaults/<id>/…", () => {
    expect(vaultStoreDisplayPaths("/data", "notes")).toEqual({
      storePath: "/data/.upriv/vaults/notes/store/",
      backupsPath: "/data/.upriv/vaults/notes/backups/",
    });
  });

  it("does not POSIX-join SAF content URIs", () => {
    const uri = "content://com.android.externalstorage.documents/tree/primary%3AUpriv";
    expect(vaultStoreDisplayPaths(uri, "notes")).toEqual({
      storePath: `${uri} · .upriv/vaults/notes/store`,
      backupsPath: `${uri} · .upriv/vaults/notes/backups`,
    });
  });
});

describe("vaultRootLogsDisplayPath", () => {
  it("places logs under .upriv/, not beside the vault-root", () => {
    expect(vaultRootLogsDisplayPath("/data")).toBe("/data/.upriv/logs");
    expect(vaultRootLogsDisplayPath("/data/")).toBe("/data/.upriv/logs");
  });

  it("labels SAF trees without joining path segments", () => {
    const uri = "content://com.android.externalstorage.documents/tree/primary%3AUpriv";
    expect(vaultRootLogsDisplayPath(uri)).toBe(`${uri} · .upriv/logs`);
  });
});
