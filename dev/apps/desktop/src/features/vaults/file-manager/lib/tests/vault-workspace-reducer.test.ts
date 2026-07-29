import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspaceState,
  hasUnsavedWorkspaceChanges,
  isPathDirty,
  resolveUnsavedPrompt,
  vaultWorkspaceReducer,
} from "../vaultWorkspaceReducer";

describe("createDefaultWorkspaceState", () => {
  it("starts with root expanded and no dirty tabs", () => {
    const state = createDefaultWorkspaceState();
    expect(state.expandedPaths).toEqual(["/"]);
    expect(state.openTabs).toEqual([]);
    expect(hasUnsavedWorkspaceChanges(state)).toBe(false);
  });
});

describe("vaultWorkspaceReducer", () => {
  it("opens a file and selects it as active tab", () => {
    const state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/notes.md",
    });
    expect(state.openTabs).toEqual(["/notes.md"]);
    expect(state.activeTabPath).toBe("/notes.md");
    expect(state.selectedPath).toBe("/notes.md");
  });

  it("marks editor drafts dirty and clears on mark_saved", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "hello",
    });
    expect(isPathDirty(state, "/a.md")).toBe(true);
    expect(hasUnsavedWorkspaceChanges(state)).toBe(true);

    state = vaultWorkspaceReducer(state, {
      type: "mark_saved",
      path: "/a.md",
      content: "hello",
    });
    expect(isPathDirty(state, "/a.md")).toBe(false);
  });

  it("prompts before closing a dirty tab", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, { type: "request_close_tab", path: "/a.md" });
    expect(state.unsavedPrompt).toEqual({ type: "close_tab", path: "/a.md" });
    expect(state.openTabs).toContain("/a.md");
  });

  it("closes a clean tab without prompt", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, { type: "request_close_tab", path: "/a.md" });
    expect(state.openTabs).toEqual([]);
    expect(state.unsavedPrompt).toBeNull();
  });

  it("prompts before switching away from a dirty active tab", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/b.md" });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/b.md",
      content: "dirty",
    });
    state = vaultWorkspaceReducer(state, { type: "request_active_tab", path: "/a.md" });
    expect(state.unsavedPrompt).toEqual({ type: "switch_tab", toPath: "/a.md" });
    expect(state.activeTabPath).toBe("/b.md");
  });

  it("toggles folder expansion", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "toggle_folder", path: "/docs" });
    expect(state.expandedPaths).toContain("/docs");
    state = vaultWorkspaceReducer(state, { type: "toggle_folder", path: "/docs" });
    expect(state.expandedPaths).not.toContain("/docs");
  });

  it("remaps paths after rename", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/old.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/old.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "remap_paths",
      map: { "/old.md": "/new.md" },
    });
    expect(state.openTabs).toEqual(["/new.md"]);
    expect(state.activeTabPath).toBe("/new.md");
    expect(state.dirtyPaths).toEqual(["/new.md"]);
    expect(state.editorDrafts["/new.md"]).toBe("x");
  });

  it("discard_unsaved_and closes a dirty tab after discard", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, { type: "request_close_tab", path: "/a.md" });
    state = vaultWorkspaceReducer(state, {
      type: "discard_unsaved_and",
      next: resolveUnsavedPrompt(state, state.unsavedPrompt!),
    });
    expect(state.openTabs).toEqual([]);
    expect(hasUnsavedWorkspaceChanges(state)).toBe(false);
  });

  it("remove_paths drops tabs, drafts, and dirty markers", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/b.md" });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, { type: "remove_paths", paths: ["/a.md"] });
    expect(state.openTabs).toEqual(["/b.md"]);
    expect(state.dirtyPaths).toEqual([]);
    expect(state.editorDrafts["/a.md"]).toBeUndefined();
  });
});

describe("resolveUnsavedPrompt", () => {
  it("maps prompt types to follow-up actions", () => {
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "close_tab", path: "/a" }),
    ).toEqual({
      type: "close_tab",
      path: "/a",
    });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "switch_tab", toPath: "/b" }),
    ).toEqual({ type: "request_active_tab", path: "/b" });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "dismiss_workspace" }),
    ).toEqual({ type: "set_unsaved_prompt", prompt: null });
  });
});
