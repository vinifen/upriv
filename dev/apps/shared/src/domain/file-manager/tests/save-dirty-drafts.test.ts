import { describe, expect, it } from "vitest";
import { createDefaultWorkspaceState, type VaultWorkspaceState } from "../workspaceTypes";
import {
  MAX_DIRTY_DRAFT_SAVE_PASSES,
  saveDirtyVaultDrafts,
  withSavedDraftDiskContents,
  type DirtyDraftVault,
} from "../saveDirtyDrafts";

function vault(id: string, workspace: VaultWorkspaceState): DirtyDraftVault {
  return { vaultId: id, workspace };
}

function withDraft(path: string, content: string): VaultWorkspaceState {
  return {
    ...createDefaultWorkspaceState(),
    dirtyPaths: [path],
    editorDrafts: { [path]: content },
  };
}

describe("saveDirtyVaultDrafts", () => {
  it("writes each dirty draft once and marks that text saved", async () => {
    const notes = withDraft("/a.md", "a");
    const work = withDraft("/b.md", "b");
    const saved: string[] = [];
    const written: string[] = [];

    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", notes), vault("work", work)],
      writeFile: async (vaultId, path, content) => {
        written.push(`${vaultId}:${path}:${content}`);
      },
      markSaved: (vaultId, path, content) => {
        saved.push(`${vaultId}:${path}:${content}`);
      },
      isCancelled: () => false,
    });

    expect(status).toBe("saved");
    expect(written).toEqual(["notes:/a.md:a", "work:/b.md:b"]);
    expect(saved).toEqual(written);
  });

  it("stores a keystroke that landed during the write before reporting saved", async () => {
    let content = "a";
    const saved: string[] = [];

    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", withDraft("/a.md", content))],
      writeFile: async (_vaultId, _path, text) => {
        if (text === "a") content = "ab";
      },
      markSaved: (_vaultId, _path, text) => {
        saved.push(text);
      },
      isCancelled: () => false,
    });

    expect(status).toBe("saved");
    expect(saved).toEqual(["ab"]);
  });

  it("does not loop when the dirty flag is still set for text already stored", async () => {
    let writes = 0;
    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", withDraft("/a.md", "a"))],
      writeFile: async () => {
        writes += 1;
      },
      markSaved: () => undefined,
      isCancelled: () => false,
    });

    expect(status).toBe("saved");
    expect(writes).toBe(1);
  });

  it("stops when a dirty path has no draft and does not write later vaults", async () => {
    const written: string[] = [];
    const missing: VaultWorkspaceState = {
      ...createDefaultWorkspaceState(),
      dirtyPaths: ["/gone.md"],
      editorDrafts: {},
    };

    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", missing), vault("work", withDraft("/b.md", "b"))],
      writeFile: async (vaultId) => {
        written.push(vaultId);
      },
      markSaved: () => undefined,
      isCancelled: () => false,
    });

    expect(status).toBe("missing_draft");
    expect(written).toEqual([]);
  });

  it("returns failed when a write throws and does not mark that path saved", async () => {
    const saved: string[] = [];
    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", withDraft("/a.md", "a"))],
      writeFile: async () => {
        throw new Error("disk");
      },
      markSaved: () => {
        saved.push("saved");
      },
      isCancelled: () => false,
    });

    expect(status).toBe("failed");
    expect(saved).toEqual([]);
  });

  it("returns cancelled without closing over a newer pass", async () => {
    let writes = 0;
    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", withDraft("/a.md", "a"))],
      writeFile: async () => {
        writes += 1;
      },
      markSaved: () => undefined,
      isCancelled: () => writes > 0,
    });

    expect(status).toBe("cancelled");
    expect(writes).toBe(1);
  });

  it("fails closed when drafts keep changing past the pass limit", async () => {
    let content = "a";
    let writes = 0;
    const status = await saveDirtyVaultDrafts({
      readVaults: () => [vault("notes", withDraft("/a.md", content))],
      writeFile: async () => {
        writes += 1;
        content += "x";
      },
      markSaved: () => undefined,
      isCancelled: () => false,
    });

    expect(status).toBe("failed");
    expect(writes).toBe(MAX_DIRTY_DRAFT_SAVE_PASSES);
  });
});

describe("withSavedDraftDiskContents", () => {
  it("copies a clean draft into the editor cache and leaves dirty text alone", () => {
    const disk = { "/old.md": "old", "/dirty.md": "disk" };
    const next = withSavedDraftDiskContents(disk, {
      dirtyPaths: ["/dirty.md"],
      editorDrafts: { "/old.md": "saved", "/dirty.md": "typing" },
    });

    expect(next).toEqual({ "/old.md": "saved", "/dirty.md": "disk" });
    expect(next).not.toBe(disk);
  });

  it("returns the same cache when nothing clean changed", () => {
    const disk = { "/a.md": "a" };
    const next = withSavedDraftDiskContents(disk, {
      dirtyPaths: ["/a.md"],
      editorDrafts: { "/a.md": "typing" },
    });
    expect(next).toBe(disk);
  });
});
