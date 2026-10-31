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

function renderMenu(
  osFolderAvailable: boolean,
  path = "/note.md",
  folder?: Partial<Pick<FileManagerApi, "folderPresence" | "sendToFolder" | "removeFromFolder">>,
) {
  const dispatch = vi.fn();
  const fm = {
    workspace: { contextMenu: { x: 10, y: 10, path } },
    osFolderAvailable,
    folderPresence: null,
    dispatch,
    showToast: vi.fn(),
    ...folder,
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

  it("offers no folder actions on a vault whose folder holds everything", async () => {
    renderMenu(true);
    await screen.findByText("Copy path");
    expect(screen.queryByText("Send to folder")).toBeNull();
    expect(screen.queryByText("Remove from folder")).toBeNull();
  });

  it("sends a file the folder does not hold, and hides the ways to open it there", async () => {
    const sendToFolder = vi.fn(async () => undefined);
    renderMenu(true, "/note.md", {
      folderPresence: new Map([["/note.md", "none"]]),
      sendToFolder,
    });
    fireEvent.click(await screen.findByText("Send to folder"));
    expect(sendToFolder).toHaveBeenCalledWith("/note.md");
    cleanup();

    renderMenu(true, "/note.md", { folderPresence: new Map([["/note.md", "none"]]) });
    await screen.findByText("Send to folder");
    expect(screen.queryByText("Remove from folder")).toBeNull();
    expect(screen.queryByText("Open in file manager")).toBeNull();
    expect(screen.queryByText("Open in terminal")).toBeNull();
  });

  it("removes a file the folder holds", async () => {
    const removeFromFolder = vi.fn(async () => undefined);
    renderMenu(true, "/note.md", {
      folderPresence: new Map([["/note.md", "all"]]),
      removeFromFolder,
    });
    expect(await screen.findByText("Open in file manager")).toBeTruthy();
    expect(screen.queryByText("Send to folder")).toBeNull();
    fireEvent.click(screen.getByText("Remove from folder"));
    expect(removeFromFolder).toHaveBeenCalledWith("/note.md");
  });

  it("offers both on a folder that is partly there", async () => {
    renderMenu(true, "/note.md", { folderPresence: new Map([["/note.md", "some"]]) });
    expect(await screen.findByText("Send to folder")).toBeTruthy();
    expect(screen.getByText("Remove from folder")).toBeTruthy();
    expect(screen.getByText("Open in file manager")).toBeTruthy();
  });

  it("keeps Open in file manager on the root of an empty folder", async () => {
    renderMenu(true, "/", { folderPresence: new Map([["/", "none"]]) });
    expect(await screen.findByText("Send to folder")).toBeTruthy();
    expect(screen.getByText("Open in file manager")).toBeTruthy();
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
