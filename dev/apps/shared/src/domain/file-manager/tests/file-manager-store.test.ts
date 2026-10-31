import { describe, expect, it, vi } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import { createEmptyFileManagerState, fileManagerReducer } from "../dockReducer";
import {
  createFileManagerStore,
  fileManagerIndicator,
  fileManagerShell,
  sameFileManagerShell,
} from "../fileManagerStore";

const notes = vaultRowFixture({ id: "notes", displayName: "Notes", session: "open" });
const work = vaultRowFixture({ id: "work", displayName: "Work", session: "open" });

describe("createFileManagerStore", () => {
  it("tells listeners about a change and keeps quiet for a no-op", () => {
    const store = createFileManagerStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: "open_from_vault", vault: notes });
    expect(listener).toHaveBeenCalledTimes(1);
    const opened = store.getState();

    store.dispatch({ type: "maximize", vaultId: "notes" });
    store.dispatch({ type: "workspace", vaultId: "notes", action: { type: "cancel_rename" } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toBe(opened);

    unsubscribe();
    store.dispatch({ type: "minimize", vaultId: "notes" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lets a listener unsubscribe another while it runs", () => {
    const store = createFileManagerStore();
    const second = vi.fn();
    let unsubscribeSecond = () => {};
    store.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = store.subscribe(second);

    store.dispatch({ type: "open_from_vault", vault: notes });
    store.dispatch({ type: "open_from_vault", vault: work });
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("fileManagerReducer workspace", () => {
  it("keeps every entry for a workspace no-op", () => {
    const state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: notes,
    });
    expect(
      fileManagerReducer(state, {
        type: "workspace",
        vaultId: "notes",
        action: { type: "set_unsaved_prompt", prompt: null },
      }),
    ).toBe(state);
  });

  it("replaces only the entry that changed", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: notes,
    });
    state = fileManagerReducer(state, { type: "open_from_vault", vault: work });
    const next = fileManagerReducer(state, {
      type: "workspace",
      vaultId: "work",
      action: { type: "set_editor_draft", path: "/a.md", content: "a" },
    });
    expect(next.entries.notes).toBe(state.entries.notes);
    expect(next.entries.work).not.toBe(state.entries.work);
  });
});

describe("fileManagerShell", () => {
  it("lists open file managers in dock order without their workspaces", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: notes,
    });
    state = fileManagerReducer(state, { type: "open_from_vault", vault: work });

    expect(fileManagerShell(state)).toEqual({
      entries: [
        { vaultId: "notes", displayName: "Notes", surface: "minimized", importInFlight: false },
        { vaultId: "work", displayName: "Work", surface: "maximized", importInFlight: false },
      ],
      maximizedVaultId: "work",
      focusedVaultId: "work",
    });
  });

  it("is the same shell after typing and a new one after a surface change", () => {
    const opened = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: notes,
    });
    const typed = fileManagerReducer(opened, {
      type: "workspace",
      vaultId: "notes",
      action: { type: "set_editor_draft", path: "/a.md", content: "a" },
    });
    expect(sameFileManagerShell(fileManagerShell(opened), fileManagerShell(typed))).toBe(true);

    const minimized = fileManagerReducer(typed, { type: "minimize", vaultId: "notes" });
    expect(sameFileManagerShell(fileManagerShell(typed), fileManagerShell(minimized))).toBe(false);
  });
});

describe("fileManagerIndicator", () => {
  it("is the import, else the surface, else nothing", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: notes,
    });
    expect(fileManagerIndicator(state, "notes")).toBe("maximized");
    expect(fileManagerIndicator(state, "work")).toBeNull();
    state = fileManagerReducer(state, {
      type: "set_import_in_flight",
      vaultId: "notes",
      inFlight: true,
    });
    expect(fileManagerIndicator(state, "notes")).toBe("importing");
  });
});
