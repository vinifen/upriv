/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MARKDOWN_COPY_DOUBLE_TAP_MS,
  MARKDOWN_PREVIEW_MAX_CHARS,
  markdownOutline,
} from "@upriv/shared";
import { I18nProvider } from "@/i18n";
import { EditorPathBar } from "../EditorPathBar";
import { MarkdownOutlinePanel, MarkdownOutlineToggle } from "../MarkdownOutline";
import { MarkdownPreview } from "../MarkdownPreview";
import { MarkdownViewToggle } from "../MarkdownViewToggle";

const NOTE = [
  "PIN `1234`",
  "",
  "```",
  "hunter2",
  "```",
  "",
  "[site](https://example.com/a) [bad](javascript:alert(1))",
  "",
  "![alt](https://tracker.example/pixel.png)",
  "",
  '<img src="https://tracker.example/c.png">',
  "",
  "- [x] rotated",
].join("\n");

afterEach(cleanup);

function renderWithI18n(node: ReactNode) {
  return render(createElement(I18nProvider, { locale: "en", children: node }));
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("MarkdownPreview", () => {
  it("draws copyable code, safe links, and text-only images", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const onCopyFailed = vi.fn();
    const { container } = renderWithI18n(
      createElement(MarkdownPreview, { markdown: NOTE, onCopyFailed }),
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Copy" }).length).toBeGreaterThan(0);
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("tracker.example/pixel");
    expect(screen.getByText("alt")).toBeTruthy();
    expect(screen.getByText('<img src="https://tracker.example/c.png">')).toBeTruthy();

    const site = screen.getByRole("link", { name: "site" });
    expect(site.getAttribute("href")).toBe("https://example.com/a");
    expect(site.getAttribute("target")).toBe("_blank");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.getByText(/bad/)).toBeTruthy();

    const checkbox = screen.getByRole("checkbox");
    expect((checkbox as HTMLButtonElement).disabled).toBe(true);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1234"));
    await screen.findByRole("button", { name: "Copied" });

    writeText.mockClear();
    const pin = screen.getByText("1234");
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    fireEvent.click(pin);
    now.mockReturnValue(10_000 + MARKDOWN_COPY_DOUBLE_TAP_MS);
    fireEvent.click(pin);
    expect(writeText).not.toHaveBeenCalled();
    now.mockReturnValue(10_000 + MARKDOWN_COPY_DOUBLE_TAP_MS + 450);
    fireEvent.click(pin);
    now.mockRestore();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1234"));

    writeText.mockClear();
    const secret = screen.getByText("hunter2");
    fireEvent.click(secret);
    fireEvent.click(secret);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("hunter2"));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1));
    expect(screen.getByText("hunter2").closest("div")?.className).toContain("ring-accent");
    expect(screen.getByText("1234").parentElement?.className).not.toContain("ring-accent");

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(onCopyFailed).toHaveBeenCalledOnce());
  });

  it("toggles a task in the draft when the note is editable", async () => {
    const onChange = vi.fn();
    const markdown = "- [ ] one\n- [x] two\n";
    renderWithI18n(
      createElement(MarkdownPreview, { markdown, onCopyFailed: () => undefined, onChange }),
    );
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(boxes.every((box) => !(box as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith("- [x] one\n- [x] two\n");
    fireEvent.click(boxes[1]);
    expect(onChange).toHaveBeenLastCalledWith("- [ ] one\n- [ ] two\n");
  });

  it("asks for Code when the note is over the preview cap", async () => {
    renderWithI18n(
      createElement(MarkdownPreview, {
        markdown: "a".repeat(MARKDOWN_PREVIEW_MAX_CHARS + 1),
        onCopyFailed: () => undefined,
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("This file is too large to preview. Switch to Code to read it."),
      ).toBeTruthy();
    });
  });

  it("reports match count for search queries and ignores UI chrome like copy buttons", async () => {
    const onMatchCountChange = vi.fn();
    renderWithI18n(
      createElement(MarkdownPreview, {
        markdown: "```ts\nconsole.log('copy me');\n```\n\nSome plain copy here.",
        searchQuery: "copy",
        onMatchCountChange,
        onCopyFailed: () => undefined,
      }),
    );
    await waitFor(() => {
      // "copy" appears once in code text and once in plain text = 2 matches.
      // The "Copy" button label and "ts" language badge must NOT be counted.
      expect(onMatchCountChange).toHaveBeenCalledWith(2);
    });
  });
});

describe("MarkdownViewToggle", () => {
  it("toggles between preview and source mode on click", async () => {
    const onChange = vi.fn();
    const { rerender } = renderWithI18n(
      createElement(MarkdownViewToggle, { mode: "preview", onChange }),
    );
    const btn = await screen.findByRole("button", { name: "Markdown view" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith("source");

    rerender(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(MarkdownViewToggle, { mode: "source", onChange }),
      }),
    );
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith("preview");
  });

  it("shows code and eye icons with title and accessibility label", async () => {
    renderWithI18n(createElement(MarkdownViewToggle, { mode: "preview", onChange: vi.fn() }));
    const btn = await screen.findByRole("button", { name: "Markdown view" });
    expect(btn.querySelectorAll("svg").length).toBe(2);
    expect(btn.getAttribute("title")).toBe("Code / Read");
  });
});

describe("MarkdownOutline", () => {
  it("toggles open and closed", async () => {
    const onChange = vi.fn();
    renderWithI18n(createElement(MarkdownOutlineToggle, { open: false, onChange }));
    fireEvent.click(await screen.findByRole("button", { name: "Show outline" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("lists headings indented by nesting and jumps on click", async () => {
    const onSelect = vi.fn();
    renderWithI18n(
      createElement(MarkdownOutlinePanel, {
        outline: markdownOutline("# Top\n\n## Child\n\n> # quoted\n\n# Next\n"),
        onSelect,
      }),
    );
    const child = await screen.findByRole("button", { name: "Child" });
    expect(child.style.paddingLeft).toBe("1.5rem");
    expect(screen.getByRole("button", { name: "Top" }).style.paddingLeft).toBe("0.75rem");
    expect(screen.queryByRole("button", { name: "quoted" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onSelect).toHaveBeenCalledWith(2, expect.objectContaining({ text: "Next", level: 0 }));
  });

  it("says when a note has no headings", async () => {
    renderWithI18n(
      createElement(MarkdownOutlinePanel, {
        outline: markdownOutline("just text"),
        onSelect: vi.fn(),
      }),
    );
    expect(await screen.findByText("This file has no headings.")).toBeTruthy();
  });

  it("marks only top-level headings as outline anchors in Read view", async () => {
    const { container } = renderWithI18n(
      createElement(MarkdownPreview, {
        markdown: "# Top\n\n> # quoted\n\n## Child\n",
        onCopyFailed: vi.fn(),
      }),
    );
    await screen.findByText("Top");
    expect(
      [...container.querySelectorAll("[data-outline-heading]")].map((h) => h.textContent),
    ).toEqual(["Top", "Child"]);
  });

  it("highlights the active heading based on activeIndex", async () => {
    const onSelect = vi.fn();
    const { rerender } = renderWithI18n(
      createElement(MarkdownOutlinePanel, {
        outline: markdownOutline("# First\n\n## Second\n"),
        activeIndex: 0,
        onSelect,
      }),
    );
    const firstBtn = await screen.findByRole("button", { name: "First" });
    const secondBtn = screen.getByRole("button", { name: "Second" });

    expect(firstBtn.getAttribute("aria-current")).toBe("location");
    expect(firstBtn.className).toContain("text-accent");
    expect(secondBtn.getAttribute("aria-current")).toBeNull();
    expect(secondBtn.className).not.toContain("text-accent");

    rerender(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(MarkdownOutlinePanel, {
          outline: markdownOutline("# First\n\n## Second\n"),
          activeIndex: 1,
          onSelect,
        }),
      }),
    );

    expect(firstBtn.getAttribute("aria-current")).toBeNull();
    expect(secondBtn.getAttribute("aria-current")).toBe("location");
    expect(secondBtn.className).toContain("text-accent");
  });

  it("notifies when active heading changes or initializes in preview", async () => {
    const onActiveHeadingChange = vi.fn();
    renderWithI18n(
      createElement(MarkdownPreview, {
        markdown: "# Heading 1\n\nSome text\n\n# Heading 2\n",
        onCopyFailed: vi.fn(),
        onActiveHeadingChange,
      }),
    );
    await screen.findByText("Heading 1");
    await waitFor(() => {
      expect(onActiveHeadingChange).toHaveBeenCalled();
    });
  });
});

describe("EditorPathBar", () => {
  it("shows vault name › folders › file next to its controls", async () => {
    renderWithI18n(
      createElement(EditorPathBar, {
        vaultName: "Personal",
        path: "/notes/bank.md",
        children: createElement("button", { type: "button" }, "Code"),
      }),
    );
    const nav = await screen.findByRole("navigation", { name: "File path" });
    expect(nav.getAttribute("title")).toBe("Personal › notes › bank.md");
    expect([...nav.querySelectorAll("span:not([aria-hidden])")].map((s) => s.textContent)).toEqual([
      "Personal",
      "notes",
      "bank.md",
    ]);
    expect(screen.getByRole("button", { name: "Code" })).toBeTruthy();
  });
});
