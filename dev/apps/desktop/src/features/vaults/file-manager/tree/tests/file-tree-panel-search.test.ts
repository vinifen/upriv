/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useReducer } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultWorkspaceState,
  serializeWorkspaceSnapshot,
  vaultWorkspaceReducer,
  workspaceSnapshotFromState,
  type FileTreeNode,
  type VaultWorkspaceState,
} from "@upriv/shared";
import { I18nProvider } from "@/i18n";
import type { FileManagerApi } from "../../hooks/useVaultFileManager";
import { FileTreePanel } from "../FileTreePanel";

const TREE: FileTreeNode = {
  name: "Notes",
  type: "folder",
  children: [
    { name: "docs", type: "folder", children: [{ name: "plan-b.md", type: "file" }] },
    { name: "plan.md", type: "file" },
    { name: "report.md", type: "file" },
  ],
};
const NOTHING: ReadonlySet<string> = new Set();

let latest = createDefaultWorkspaceState();
/** The file the layout would save right now. */
const savedLayout = () => serializeWorkspaceSnapshot(workspaceSnapshotFromState(latest));

function Panel({ workspace: initial }: { workspace: VaultWorkspaceState }) {
  const [workspace, dispatch] = useReducer(vaultWorkspaceReducer, initial);
  latest = workspace;
  const fm = {
    vaultId: "notes",
    tree: TREE,
    displayTree: TREE,
    treeStatus: "ready",
    workspace,
    dispatch,
    folderPresence: null,
    pendingImportPaths: NOTHING,
    processingImportPaths: NOTHING,
  } as unknown as FileManagerApi;
  return createElement(FileTreePanel, { fm, splitPercent: 30, layout: "row" });
}

const TOGGLE = { name: "Find files and folders" };

/** Resolves once the strings have loaded. */
async function renderPanel(patch: Partial<VaultWorkspaceState> = {}) {
  render(
    createElement(I18nProvider, {
      locale: "en",
      children: createElement(Panel, {
        workspace: { ...createDefaultWorkspaceState(), ...patch },
      }),
    }),
  );
  await screen.findByRole("button", TOGGLE);
}

const TOGGLE_AT_WORK = { name: "Find files and folders (search is on)" };

const toggle = () => screen.getByRole("button", TOGGLE);
const field = () => screen.queryByRole<HTMLInputElement>("textbox", { name: "Find files…" });
const row = (name: string) => screen.queryByRole("button", { name });

describe("FileTreePanel search", () => {
  afterEach(cleanup);

  it("starts closed, with the button beside the other four", async () => {
    await renderPanel();
    expect(field()).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    const tools = toggle().closest("div")?.parentElement;
    expect(tools?.querySelectorAll("button")).toHaveLength(5);
  });

  it("opens from the button, ready to type", async () => {
    await renderPanel();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(field());
  });

  it("leaves focus alone when the layout restores it open", async () => {
    await renderPanel({ explorerSearchOpen: true });
    expect(field()).not.toBeNull();
    expect(document.activeElement).not.toBe(field());
  });

  it("keeps filtering with the bar closed, and the button says so", async () => {
    await renderPanel({ explorerSearchOpen: true });
    fireEvent.change(field()!, { target: { value: "plan" } });
    await waitFor(() => expect(row("report.md")).toBeNull());
    expect(row("plan.md")).not.toBeNull();

    fireEvent.click(toggle());
    expect(field()).toBeNull();
    expect(row("report.md")).toBeNull();
    expect(row("plan.md")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", TOGGLE_AT_WORK));
    expect(field()?.value).toBe("plan");
  });

  it("restores a saved search, closed bar included", async () => {
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(Panel, {
          workspace: { ...createDefaultWorkspaceState(), explorerSearchQuery: "plan" },
        }),
      }),
    );
    await screen.findByRole("button", TOGGLE_AT_WORK);
    expect(row("report.md")).toBeNull();
    expect(row("plan.md")).not.toBeNull();
  });

  it("shows every row again once the text is cleared", async () => {
    await renderPanel({ explorerSearchOpen: true, explorerSearchQuery: "plan" });
    await waitFor(() => expect(row("report.md")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(row("report.md")).not.toBeNull());
  });

  it("collapses a folder in the results and opens it again, with nothing saved", async () => {
    await renderPanel({ explorerSearchOpen: true, explorerSearchQuery: "plan" });
    await waitFor(() => expect(row("plan-b.md")).not.toBeNull());
    const layout = savedLayout();

    fireEvent.click(row("docs")!);
    expect(row("plan-b.md")).toBeNull();
    expect(row("plan.md")).not.toBeNull();
    expect(savedLayout()).toBe(layout);

    fireEvent.click(row("docs")!);
    expect(row("plan-b.md")).not.toBeNull();
    expect(savedLayout()).toBe(layout);
  });

  it("leaves the saved folders as they were once the search ends", async () => {
    await renderPanel({
      explorerSearchOpen: true,
      explorerSearchQuery: "plan",
      expandedPaths: ["/", "/docs"],
    });
    await waitFor(() => expect(row("plan-b.md")).not.toBeNull());
    fireEvent.click(row("docs")!);
    expect(row("plan-b.md")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(row("report.md")).not.toBeNull());
    expect(row("plan-b.md")).not.toBeNull();
  });

  it("opens every folder again for a new search", async () => {
    await renderPanel({ explorerSearchOpen: true, explorerSearchQuery: "plan" });
    await waitFor(() => expect(row("plan-b.md")).not.toBeNull());
    fireEvent.click(row("docs")!);
    expect(row("plan-b.md")).toBeNull();

    fireEvent.change(field()!, { target: { value: "plan-" } });
    await waitFor(() => expect(row("plan-b.md")).not.toBeNull());
  });

  it("keeps a collapsed folder collapsed while the bar closes and opens", async () => {
    await renderPanel({ explorerSearchOpen: true, explorerSearchQuery: "plan" });
    await waitFor(() => expect(row("plan-b.md")).not.toBeNull());
    fireEvent.click(row("docs")!);

    fireEvent.click(toggle());
    expect(row("plan-b.md")).toBeNull();
    fireEvent.click(screen.getByRole("button", TOGGLE_AT_WORK));
    expect(row("plan-b.md")).toBeNull();
  });

  it("saves a folder toggled with no search running", async () => {
    await renderPanel();
    const layout = savedLayout();
    fireEvent.click(row("docs")!);
    expect(row("plan-b.md")).not.toBeNull();
    expect(savedLayout()).not.toBe(layout);
  });

  it("keeps a row being renamed that does not match", async () => {
    await renderPanel({
      explorerSearchOpen: true,
      explorerSearchQuery: "plan",
      renamingPath: "/report.md",
    });
    expect(screen.getByDisplayValue("report.md")).not.toBeNull();
  });

  it("clears on the first Escape and closes on the next", async () => {
    await renderPanel({ explorerSearchOpen: true });
    fireEvent.change(field()!, { target: { value: "plan" } });
    fireEvent.keyDown(field()!, { key: "Escape" });
    expect(field()?.value).toBe("");

    fireEvent.keyDown(field()!, { key: "Escape" });
    expect(field()).toBeNull();
  });
});
