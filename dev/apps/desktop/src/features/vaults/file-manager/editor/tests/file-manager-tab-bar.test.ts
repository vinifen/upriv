/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceState, type VaultWorkspaceState } from "@upriv/shared";
import { I18nProvider } from "@/i18n";
import { FileManagerTabBar } from "../FileManagerTabBar";

beforeAll(() => {
  // jsdom has no layout: the strip scrolls the active tab into view and reads reduced motion.
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function workspaceWith(tabs: string[], dirty: string[] = []): VaultWorkspaceState {
  return {
    ...createDefaultWorkspaceState(),
    openTabs: tabs,
    activeTabPath: tabs[0] ?? null,
    dirtyPaths: dirty,
    editorDrafts: Object.fromEntries(dirty.map((path) => [path, "draft"])),
  };
}

function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: "all",
    dropEffect: "none",
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
}

function renderBar(workspace: VaultWorkspaceState, onAction = vi.fn()) {
  // Stands in for the workspace around the strip, which offers OS imports as `copy`.
  const workspaceDragOver = vi.fn((event: { dataTransfer: { dropEffect: string } }) => {
    event.dataTransfer.dropEffect = "copy";
  });
  render(
    createElement(I18nProvider, {
      locale: "en",
      children: createElement(
        "div",
        { onDragOver: workspaceDragOver },
        createElement(FileManagerTabBar, {
          workspace,
          onWorkspaceAction: onAction,
          onDelete: vi.fn(),
          isPathPending: () => false,
        }),
      ),
    }),
  );
  return { onAction, workspaceDragOver };
}

async function tabFrame(name: string): Promise<HTMLElement> {
  const frame = (await screen.findByRole("tab", { name })).parentElement;
  if (!frame) throw new Error(`no frame for ${name}`);
  return frame;
}

describe("FileManagerTabBar", () => {
  it("reorders when a tab is dropped on another, keeping the drag a move", async () => {
    const { onAction, workspaceDragOver } = renderBar(workspaceWith(["/a.md", "/b.md"]));
    const dataTransfer = transfer();

    fireEvent.dragStart(await tabFrame("a.md"), { dataTransfer });
    fireEvent.dragOver(await tabFrame("b.md"), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    expect(workspaceDragOver).not.toHaveBeenCalled();

    fireEvent.drop(await tabFrame("b.md"), { dataTransfer });
    expect(onAction).toHaveBeenCalledWith({
      type: "reorder_tabs",
      fromPath: "/a.md",
      toPath: "/b.md",
    });
  });

  it("leaves a drag that did not start on a tab to the workspace", async () => {
    const { onAction, workspaceDragOver } = renderBar(workspaceWith(["/a.md", "/b.md"]));
    const dataTransfer = transfer();

    fireEvent.dragOver(await tabFrame("b.md"), { dataTransfer });
    expect(workspaceDragOver).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});
