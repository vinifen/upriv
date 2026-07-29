import { beforeEach, describe, expect, it } from "vitest";
import { findNode } from "@upriv/shared";
import {
  createVaultFile,
  createVaultFolder,
  deleteVaultPath,
  ensureVaultFolder,
  getVaultFileContent,
  getVaultFileTree,
  getVaultTreeRevision,
  importVaultFile,
  isVaultFileEditable,
  moveVaultPath,
  renameVaultPath,
  resetVaultFileSession,
  setVaultFileContent,
} from "../fileSystem";

const VAULT = "my-encrypted-notes";

describe("mock vault fileSystem", () => {
  beforeEach(() => {
    resetVaultFileSession(VAULT);
  });

  it("creates unique sibling files and folders", () => {
    const a = createVaultFile(VAULT, "/", "scratch.md");
    const b = createVaultFile(VAULT, "/", "scratch.md");
    expect(a).toBe("/scratch.md");
    expect(b).toBe("/scratch-2.md");

    const folder = createVaultFolder(VAULT, "/", "Notes");
    expect(folder).toBe("/Notes");
    expect(findNode(getVaultFileTree(VAULT), "/Notes")?.type).toBe("folder");
  });

  it("ensureVaultFolder is idempotent", () => {
    const first = ensureVaultFolder(VAULT, "/", "Imports");
    const rev = getVaultTreeRevision(VAULT);
    const second = ensureVaultFolder(VAULT, "/", "Imports");
    expect(first).toBe("/Imports");
    expect(second).toBe("/Imports");
    expect(getVaultTreeRevision(VAULT)).toBe(rev);
  });

  it("imports content and tracks editability", () => {
    const path = importVaultFile(VAULT, "/", "todo.md", "# todo");
    expect(path).toBe("/todo.md");
    expect(getVaultFileContent(VAULT, path!)?.content).toBe("# todo");
    expect(isVaultFileEditable(VAULT, path!)).toBe(true);

    expect(importVaultFile(VAULT, "/missing", "x.md", "nope")).toBeNull();
  });

  it("renames and remaps content paths", () => {
    const path = createVaultFile(VAULT, "/", "draft.md");
    setVaultFileContent(VAULT, path!, "hello");
    const renamed = renameVaultPath(VAULT, path!, "final.md");
    expect(renamed).toBe("/final.md");
    expect(getVaultFileContent(VAULT, "/final.md")?.content).toBe("hello");
    expect(getVaultFileContent(VAULT, "/draft.md")).toBeNull();
    expect(renameVaultPath(VAULT, "/", "nope")).toBeNull();
  });

  it("moves files between folders and rejects collisions", () => {
    const folder = createVaultFolder(VAULT, "/", "Target");
    const file = createVaultFile(VAULT, "/", "move-me.md");
    setVaultFileContent(VAULT, file!, "payload");

    const moved = moveVaultPath(VAULT, file!, folder!);
    expect(moved).toBe("/Target/move-me.md");
    expect(getVaultFileContent(VAULT, moved!)?.content).toBe("payload");

    createVaultFile(VAULT, "/", "move-me.md");
    expect(moveVaultPath(VAULT, "/move-me.md", folder!)).toBeNull();
  });

  it("refuses to delete the root", () => {
    expect(deleteVaultPath(VAULT, "/")).toBe(false);
    const path = createVaultFile(VAULT, "/", "temp.md");
    expect(deleteVaultPath(VAULT, path!)).toBe(true);
    expect(getVaultFileContent(VAULT, path!)).toBeNull();
  });
});
