/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { VaultFileSystemService, VaultListItem } from "@upriv/shared";
import {
  FileManagerProvider,
  useFileManager,
  useFileManagerEntry,
  useFileManagerSelector,
  useFileManagerShell,
} from "@upriv/shared/react";

/** The fields the file manager reads from a list row. */
function openVault(id: string, displayName: string): VaultListItem {
  return { id, displayName, session: "open", storageMode: "encrypted_dir" } as VaultListItem;
}

const notes = openVault("notes", "Notes");
const work = openVault("work", "Work");

const fs = { resetSession: () => undefined } as unknown as VaultFileSystemService;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(FileManagerProvider, { fs, children });
}

function renderFileManager() {
  return renderHook(
    () => {
      const controller = useFileManager();
      const notesEntry = useFileManagerEntry("notes");
      const workEntry = useFileManagerEntry("work");
      const shell = useFileManagerShell();
      const maximized = useFileManagerSelector((state) => state.maximizedVaultId !== null);
      return { controller, notesEntry, workEntry, shell, maximized };
    },
    { wrapper },
  );
}

/** Renders of one reader under the provider, for the vault the test writes to. */
function countRenders(read: () => unknown) {
  let renders = 0;
  const view = renderHook(
    () => {
      renders += 1;
      return { controller: useFileManager(), value: read() };
    },
    { wrapper },
  );
  return { ...view, renders: () => renders };
}

describe("FileManagerProvider", () => {
  it("keeps one controller for its life", () => {
    const { result, rerender } = renderFileManager();
    const first = result.current.controller;
    rerender();
    expect(result.current.controller).toBe(first);
  });

  it("hands each reader the same value until its own slice changes", () => {
    const { result } = renderFileManager();
    act(() => {
      result.current.controller.openFromVault(notes);
      result.current.controller.openFromVault(work);
    });
    const { notesEntry, shell, maximized } = result.current;

    act(() =>
      result.current.controller.dispatchWorkspace("work", {
        type: "set_editor_draft",
        path: "/a.md",
        content: "typing",
      }),
    );
    expect(result.current.notesEntry).toBe(notesEntry);
    expect(result.current.shell).toBe(shell);
    expect(result.current.maximized).toBe(maximized);
    expect(result.current.workEntry?.workspace.editorDrafts["/a.md"]).toBe("typing");

    act(() => result.current.controller.minimize("work"));
    expect(result.current.shell).not.toBe(shell);
    expect(result.current.maximized).toBe(false);
  });

  it("reads an entry as it is now, before the next render", () => {
    const { result } = renderFileManager();
    act(() => result.current.controller.openFromVault(notes));
    let seen: string | undefined;
    act(() => {
      result.current.controller.dispatchWorkspace("notes", {
        type: "set_editor_draft",
        path: "/a.md",
        content: "saved",
      });
      seen = result.current.controller.getEntry("notes")?.workspace.editorDrafts["/a.md"];
    });
    expect(seen).toBe("saved");
  });

  it("drops a vault's entry when it closes", () => {
    const { result } = renderFileManager();
    act(() => result.current.controller.openFromVault(notes));
    act(() => result.current.controller.purgeForVaultClose("notes"));
    expect(result.current.notesEntry).toBeNull();
    expect(result.current.shell.entries).toEqual([]);
  });

  it("does not draw the dock again while a vault's text changes", () => {
    const { result, renders } = countRenders(useFileManagerShell);
    act(() => result.current.controller.openFromVault(notes));
    const after = renders();
    for (const content of ["a", "ab", "abc"]) {
      act(() =>
        result.current.controller.dispatchWorkspace("notes", {
          type: "set_editor_draft",
          path: "/a.md",
          content,
        }),
      );
    }
    expect(renders()).toBe(after);
  });
});
