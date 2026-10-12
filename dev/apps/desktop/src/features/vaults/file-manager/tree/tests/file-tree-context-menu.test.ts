/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "@upriv/shared";
import { I18nProvider } from "@/i18n";
import type { FileManagerApi } from "../../hooks/useVaultFileManager";
import { FileTreeContextMenu } from "../FileTreeContextMenu";

const TREE: FileTreeNode = {
  name: "",
  type: "folder",
  children: [{ name: "note.md", type: "file" }],
};

afterEach(cleanup);

function renderMenu(osFolderAvailable: boolean, path = "/note.md") {
  const dispatch = vi.fn();
  const fm = {
    workspace: { contextMenu: { x: 10, y: 10, path } },
    osFolderAvailable,
    dispatch,
    showToast: vi.fn(),
  } as unknown as FileManagerApi;
  render(
    createElement(I18nProvider, {
      locale: "en",
      children: createElement(FileTreeContextMenu, { fm, tree: TREE }),
    }),
  );
  return dispatch;
}

describe("FileTreeContextMenu", () => {
  it("hides the OS folder actions when the vault has no mount", async () => {
    renderMenu(false);
    expect(await screen.findByText("Copy path")).toBeTruthy();
    expect(screen.queryByText("Open in file manager")).toBeNull();
    expect(screen.queryByText("Open in terminal")).toBeNull();
  });

  it("shows the OS folder actions when the mount is live", async () => {
    renderMenu(true);
    expect(await screen.findByText("Open in file manager")).toBeTruthy();
    expect(screen.getByText("Open in terminal")).toBeTruthy();
  });

  it("offers Hide explorer only on the explorer root menu", async () => {
    const dispatch = renderMenu(false, "/");
    fireEvent.click(await screen.findByText("Hide explorer"));
    expect(dispatch).toHaveBeenCalledWith({ type: "set_explorer_collapsed", collapsed: true });

    cleanup();
    renderMenu(false);
    expect(await screen.findByText("Copy path")).toBeTruthy();
    expect(screen.queryByText("Hide explorer")).toBeNull();
  });
});
