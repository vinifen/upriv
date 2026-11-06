/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultWorkspaceState,
  vaultWorkspaceReducer,
  type FileTreeNode,
  type HeldFileItem,
  type HeldSummary,
  type VaultWorkspaceState,
} from "@upriv/shared";
import { useExplorerProblems, useExplorerSearch, type VaultHeld } from "@upriv/shared/react";
import { I18nProvider } from "@/i18n";
import type { FileManagerApi } from "../../hooks/useVaultFileManager";
import { FileTreePanel } from "../FileTreePanel";

const BROKEN: FileTreeNode = {
  name: "Notes",
  type: "folder",
  children: [
    {
      name: "docs",
      type: "folder",
      children: [
        { name: "gone.pdf", type: "file", problem: "missing" },
        { name: "fine.md", type: "file" },
      ],
    },
    { name: "bad.bin", type: "file", problem: "damaged" },
    { name: "plan.md", type: "file" },
  ],
};
const HEALTHY: FileTreeNode = {
  name: "Notes",
  type: "folder",
  children: [{ name: "plan.md", type: "file" }],
};
const NOTHING: ReadonlySet<string> = new Set();

let latest = createDefaultWorkspaceState();

function heldWith(summary: HeldSummary | null, show = vi.fn()): VaultHeld {
  return {
    summary,
    open: false,
    show,
    working: NOTHING,
    restore: async () => null,
    remove: async () => false,
  };
}

function Panel({
  tree,
  held,
  workspace: initial,
}: {
  tree: FileTreeNode;
  held: VaultHeld;
  workspace: VaultWorkspaceState;
}) {
  const [workspace, dispatch] = useReducer(vaultWorkspaceReducer, initial);
  latest = workspace;
  const explorerSearch = useExplorerSearch(workspace, dispatch);
  const explorerProblems = useExplorerProblems(tree, workspace, dispatch, explorerSearch.show);
  const fm = {
    vaultId: "notes",
    tree,
    displayTree: tree,
    treeStatus: "ready",
    workspace,
    dispatch,
    explorerSearch,
    explorerProblems,
    held,
    folderPresence: null,
    pendingImportPaths: NOTHING,
    processingImportPaths: NOTHING,
  } as unknown as FileManagerApi;
  return createElement(FileTreePanel, { fm, splitPercent: 30, layout: "row" });
}

async function renderPanel(tree: FileTreeNode, held: VaultHeld = heldWith(null)) {
  render(
    createElement(I18nProvider, {
      locale: "en",
      children: createElement(Panel, { tree, held, workspace: createDefaultWorkspaceState() }),
    }),
  );
  await screen.findByRole("button", { name: "Find files and folders" });
}

/** A row by the start of its name: a marked row also names its mark. */
const row = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name}`) });

describe("FileTreePanel files that cannot be read", () => {
  afterEach(cleanup);

  it("shows no bar and no mark while every file reads", async () => {
    await renderPanel(HEALTHY);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("img", { name: "Damaged" })).toBeNull();
  });

  it("counts them and marks each file and the folder above it", async () => {
    await renderPanel(BROKEN);
    expect(screen.getByRole("status").textContent).toContain("2 file(s) can't be read.");
    expect(screen.getByRole("img", { name: "Damaged" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Holds files that can't be read" })).toBeTruthy();
  });

  it("shows only them, opening their folders, and every file again after", async () => {
    await renderPanel(BROKEN);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(row("gone.pdf")).not.toBeNull());
    expect(row("bad.bin")).not.toBeNull();
    expect(row("docs")).not.toBeNull();
    expect(row("plan.md")).toBeNull();
    expect(row("fine.md")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Showing only the 2 file(s)");

    fireEvent.click(screen.getByRole("button", { name: "Show all files" }));
    await waitFor(() => expect(row("plan.md")).not.toBeNull());
    // The folder that held one stays open, so the file is still easy to find.
    expect(row("fine.md")).not.toBeNull();
    expect(latest.expandedPaths).toContain("/docs");
  });

  it("ends when the search bar opens", async () => {
    await renderPanel(BROKEN);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(row("plan.md")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Find files and folders" }));
    await waitFor(() => expect(row("plan.md")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Show" })).toBeTruthy();
  });
});

describe("FileTreePanel set-aside data", () => {
  afterEach(cleanup);

  const file = (name: string): HeldFileItem => ({
    name,
    size: 300,
    heldAt: 1,
    file: { path: `/${name}.txt`, size: 6, modifiedAt: 1, currentModifiedAt: null },
  });

  it("counts the files and opens the review", async () => {
    const show = vi.fn();
    await renderPanel(
      HEALTHY,
      heldWith({ files: [file("a"), file("b")], pieces: [], pieceBytes: 0 }, show),
    );
    expect(screen.getByRole("status").textContent).toContain("2 file(s) were set aside.");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(show).toHaveBeenCalledWith(true);
  });

  it("gives the size when only pieces are set aside", async () => {
    await renderPanel(
      HEALTHY,
      heldWith({
        files: [],
        pieces: [{ name: "p.blob", size: 2048, heldAt: 1, file: null }],
        pieceBytes: 2048,
      }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "2.0 KB of data that can't be read was set aside.",
    );
  });
});
