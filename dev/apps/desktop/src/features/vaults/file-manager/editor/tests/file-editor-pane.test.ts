/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceState } from "@upriv/shared";
import { I18nProvider } from "@/i18n";
import type { FileManagerApi } from "../../hooks/useVaultFileManager";
import { FileEditorPane } from "../FileEditorPane";

afterEach(cleanup);

function createMockFm(overrides: Partial<FileManagerApi> = {}) {
  const workspace = createDefaultWorkspaceState();
  workspace.openTabs = ["/notes.md"];
  workspace.activeTabPath = "/notes.md";

  const dispatch = vi.fn();
  const fm = {
    workspace,
    dispatch,
    saveFile: vi.fn(),
    getEditorContent: vi.fn((path: string) =>
      path === "/notes.md" ? "# Header\nHello world" : "",
    ),
    fileLoadError: vi.fn(() => null),
    isFileContentReady: vi.fn(() => true),
    writesLocked: false,
    isFileEditable: vi.fn(() => true),
    isFileViewable: vi.fn(() => true),
    isFileImage: vi.fn(() => false),
    isImportPending: vi.fn(() => false),
    isImportProcessing: vi.fn(() => false),
    importBudget: { visible: false, budgetMs: 0, remainingMs: 0 },
    showToast: vi.fn(),
    ...overrides,
  } as unknown as FileManagerApi;

  return { fm, dispatch };
}

describe("FileEditorPane", () => {
  it("renders with preview mode and outline enabled by default, and toggles per-file", async () => {
    const { fm, dispatch } = createMockFm();
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    // Default: Markdown view toggle is in preview mode (aria-pressed=true)
    const viewToggle = await screen.findByRole("button", { name: "Markdown view" });
    expect(viewToggle).toBeTruthy();
    expect(viewToggle.getAttribute("aria-pressed")).toBe("true");

    // Default: Outline is open (Hide outline button visible)
    const outlineBtn = screen.getByRole("button", { name: "Hide outline" });
    expect(outlineBtn).toBeTruthy();
    expect(outlineBtn.getAttribute("aria-pressed")).toBe("true");

    // Clicking toggle switches to source view
    fireEvent.click(viewToggle);
    expect(dispatch).toHaveBeenCalledWith({
      type: "set_file_markdown_view",
      path: "/notes.md",
      view: "source",
    });

    // Toggling outline dispatches set_file_markdown_outline_open
    fireEvent.click(outlineBtn);
    expect(dispatch).toHaveBeenCalledWith({
      type: "set_file_markdown_outline_open",
      path: "/notes.md",
      open: false,
    });
  });

  it("renders in-file search button and expands search input on click and Ctrl+F", async () => {
    const { fm, dispatch } = createMockFm();
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    // Search button exists in path bar
    const searchBtn = await screen.findByRole("button", { name: "Find in file (Ctrl+F)" });
    expect(searchBtn).toBeTruthy();

    fireEvent.click(searchBtn);
    const input = await screen.findByPlaceholderText("Find in file…");
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "Header" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "set_file_search_query",
      path: "/notes.md",
      query: "Header",
    });

    // Pressing Escape collapses back
    fireEvent.keyDown(input, { key: "Escape" });
    expect(await screen.findByRole("button", { name: "Find in file (Ctrl+F)" })).toBeTruthy();

    // Pressing Ctrl+F opens search again
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(await screen.findByPlaceholderText("Find in file…")).toBeTruthy();
  });

  it("renders outline with active heading and updates selection when clicked", async () => {
    const { fm } = createMockFm({
      getEditorContent: vi.fn((path: string) =>
        path === "/notes.md" ? "# Intro\nText\n## Details\nMore text" : "",
      ),
    });
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    const introBtn = await screen.findByRole("button", { name: "Intro" });
    const detailsBtn = screen.getByRole("button", { name: "Details" });
    expect(introBtn.getAttribute("aria-current")).toBe("location");
    expect(introBtn.className).toContain("text-accent");

    fireEvent.click(detailsBtn);
    expect(detailsBtn.getAttribute("aria-current")).toBe("location");
    expect(detailsBtn.className).toContain("text-accent");
    expect(introBtn.getAttribute("aria-current")).toBeNull();
  });

  it("synchronizes search highlight backdrop scroll with textarea", async () => {
    const { fm } = createMockFm({
      getEditorContent: vi.fn(() => "Line 1\nLine 2 target\nLine 3 target\nLine 4"),
    });
    fm.workspace.fileStates = {
      "/notes.md": { markdownView: "source", markdownOutlineOpen: true, searchQuery: "target" },
    };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollTop", { value: 60, writable: true });
    Object.defineProperty(textarea, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(textarea, "offsetWidth", { value: 515, configurable: true });

    fireEvent.scroll(textarea);

    const mark = container.querySelector("mark");
    expect(mark).toBeTruthy();
    const backdrop = mark?.closest("div[aria-hidden]");
    expect(backdrop).toBeTruthy();
    expect((backdrop as HTMLDivElement).scrollTop).toBe(60);
  });

  it("renders WordWrapToggle in Code view and toggles on click and Alt+Z", async () => {
    const { fm, dispatch } = createMockFm({
      getEditorContent: vi.fn(() => "Line 1\nLine 2"),
    });
    fm.workspace.fileStates = {
      "/notes.md": { markdownView: "source", wordWrap: true },
    };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });

    const wrapBtn = screen.getByRole("button", { name: "Disable word wrap (Alt+Z)" });
    expect(wrapBtn).toBeTruthy();
    expect(wrapBtn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(wrapBtn);
    expect(fm.dispatch).toHaveBeenCalledWith({
      type: "set_file_word_wrap",
      path: "/notes.md",
      wrap: false,
    });

    // Ctrl+Alt+Z or Cmd+Alt+Z should NOT toggle word wrap
    dispatch.mockClear();
    fireEvent.keyDown(window, { key: "z", altKey: true, ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalled();

    // Plain Alt+Z toggles word wrap
    fireEvent.keyDown(window, { key: "z", altKey: true });
    expect(fm.dispatch).toHaveBeenLastCalledWith({
      type: "set_file_word_wrap",
      path: "/notes.md",
      wrap: false,
    });
  });

  it("ignores keyboard shortcuts while its file manager is hidden", async () => {
    const { fm, dispatch } = createMockFm({
      getEditorContent: vi.fn(() => "Line 1\nLine 2"),
    });
    fm.workspace.fileStates = { "/notes.md": { markdownView: "source" } };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: false }),
      }),
    );
    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: "z", altKey: true });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(fm.saveFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("applies nowrap classes and wrap=off attribute when wordWrap is false", async () => {
    const { fm } = createMockFm({
      getEditorContent: vi.fn(() => "A very long line without wrapping"),
    });
    fm.workspace.fileStates = {
      "/notes.md": { markdownView: "source", wordWrap: false },
    };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.getAttribute("wrap")).toBe("off");
    expect(textarea.className).toContain("overflow-x-auto");
    expect(textarea.className).toContain("whitespace-pre");
  });

  it("renders line numbers matching logical lines when wordWrap is enabled", async () => {
    const { fm } = createMockFm({
      getEditorContent: vi.fn(() => "Line 1\n" + "asdf".repeat(50) + "\nLine 3"),
    });
    fm.workspace.fileStates = {
      "/notes.md": { markdownView: "source", wordWrap: true },
    };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });

    // In wrapped mode, line numbers 1, 2, 3 are rendered for the 3 logical lines
    const lineElements = container.querySelectorAll(".tabular-nums");
    expect(lineElements.length).toBe(3);
    expect(lineElements[0].textContent).toBe("1");
    expect(lineElements[1].textContent).toBe("2");
    expect(lineElements[2].textContent).toBe("3");
  });

  it("renders pre-formatted line numbers when wordWrap is disabled", async () => {
    const { fm } = createMockFm({
      getEditorContent: vi.fn(() => "Line 1\nLine 2\nLine 3"),
    });
    fm.workspace.fileStates = {
      "/notes.md": { markdownView: "source", wordWrap: false },
    };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });

    const pre = container.querySelector("pre.tabular-nums");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe("1\n2\n3");
  });

  it("maintains a buffer between the opaque gutter background and textarea content so text is never covered", async () => {
    const { fm } = createMockFm({
      getEditorContent: vi.fn(() => "Line 1\nLine 2"),
    });
    fm.workspace.fileStates = {
      "/notes.md": { markdownView: "source", wordWrap: false },
    };

    const { container } = render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorPane, { fm, vaultName: "Personal", active: true }),
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("textarea")).toBeTruthy();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const gutterBg = container.querySelector(
      ".bg-surface-container-high[aria-hidden]",
    ) as HTMLDivElement;
    expect(textarea).toBeTruthy();
    expect(gutterBg).toBeTruthy();

    // The textarea's paddingLeft (0.75rem gap) must be strictly greater than gutterBg's width (0.375rem / half-gap)
    expect(textarea.style.paddingLeft).toContain("0.75rem");
    expect(gutterBg.style.width).toContain("0.375rem");
  });
});
