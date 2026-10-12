import { describe, expect, it } from "vitest";
import { markdownLinkHref } from "../markdownLink";
import {
  MARKDOWN_PREVIEW_MAX_CHARS,
  markdownOutline,
  parseMarkdownDocument,
  toggleMarkdownTask,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownPreviewModel,
} from "../markdownDocument";

function ok(source: string): Extract<MarkdownPreviewModel, { status: "ok" }> {
  const model = parseMarkdownDocument(source);
  expect(model.status).toBe("ok");
  if (model.status !== "ok") throw new Error("expected a parsed note");
  return model;
}

function hrefs(model: MarkdownPreviewModel): string[] {
  if (model.status !== "ok") return [];
  const found: string[] = [];
  const walkInline = (nodes: MarkdownInline[]) => {
    for (const node of nodes) {
      if (node.type === "link") found.push(node.href);
      if ("children" in node && node.children) walkInline(node.children);
    }
  };
  const walkBlock = (blocks: MarkdownBlock[]) => {
    for (const block of blocks) {
      if (block.type === "paragraph" || block.type === "heading") walkInline(block.children);
      if (block.type === "quote") walkBlock(block.children);
      if (block.type === "list") {
        for (const item of block.items) walkBlock(item.children);
      }
      if (block.type === "table") {
        for (const cell of block.header) walkInline(cell);
        for (const row of block.rows) for (const cell of row) walkInline(cell);
      }
    }
  };
  walkBlock(model.blocks);
  for (const note of model.footnotes) walkBlock(note.children);
  return found;
}

describe("markdownLinkHref", () => {
  it("allows http, https, and mailto and normalizes them", () => {
    expect(markdownLinkHref("https://example.com/a")).toBe("https://example.com/a");
    expect(markdownLinkHref("HTTPS://Example.COM/a")).toBe("https://example.com/a");
    expect(markdownLinkHref("http://localhost")).toBe("http://localhost/");
    expect(markdownLinkHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(markdownLinkHref(" mailto:a@b.com?subject=Hi ")).toBe("mailto:a@b.com?subject=Hi");
  });

  it("rejects scripts, files, userinfo, and relative targets", () => {
    expect(markdownLinkHref("javascript:alert(1)")).toBeNull();
    expect(markdownLinkHref("JavaScript:alert(1)")).toBeNull();
    expect(markdownLinkHref("data:text/html,hi")).toBeNull();
    expect(markdownLinkHref("file:///etc/passwd")).toBeNull();
    expect(markdownLinkHref("https://user:pw@example.com")).toBeNull();
    expect(markdownLinkHref("//example.com")).toBeNull();
    expect(markdownLinkHref("/notes.md")).toBeNull();
    expect(markdownLinkHref("https://example.com/a\\b")).toBeNull();
    expect(markdownLinkHref("https://example.com/a b")).toBeNull();
    expect(markdownLinkHref("https://example.com/a\nb")).toBeNull();
    expect(markdownLinkHref("https://example.com/\u0000x")).toBeNull();
    expect(markdownLinkHref("https://example.com/\u007fx")).toBeNull();
    expect(markdownLinkHref("mailto:")).toBeNull();
    expect(markdownLinkHref("")).toBeNull();
    expect(markdownLinkHref("http://[::1]/")).toBe("http://[::1]/");
  });
});

describe("parseMarkdownDocument", () => {
  it("renders a password note as copyable code, not HTML", () => {
    const model = ok("# Bank\n\nPIN `1234`\n\n```\nhunter2\n```\n\n- [x] rotated\n");
    expect(model.blocks[0]).toEqual({
      type: "heading",
      depth: 1,
      children: [{ type: "text", text: "Bank" }],
    });
    expect(model.blocks[1]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", text: "PIN " },
        { type: "code", text: "1234" },
      ],
    });
    expect(model.blocks[2]).toEqual({ type: "code", text: "hunter2", lang: null });
    expect(model.blocks[3]).toMatchObject({
      type: "list",
      ordered: false,
      items: [
        {
          checked: true,
          children: [{ type: "paragraph", children: [{ type: "text", text: "rotated" }] }],
        },
      ],
    });
  });

  it("keeps safe links and drops unsafe ones without losing the label", () => {
    const model = ok("[site](HTTPS://Example.COM/a) and [bad](javascript:alert(1))");
    expect(hrefs(model)).toEqual(["https://example.com/a"]);
    expect(JSON.stringify(model)).not.toContain("javascript:");
    expect(model.blocks[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "link", href: "https://example.com/a", children: [{ type: "text", text: "site" }] },
        { type: "text", text: " and bad" },
      ],
    });
  });

  it("turns literal autolinks into links and leaves code fences literal", () => {
    const linked = ok("www.example.com");
    expect(hrefs(linked)).toEqual(["http://www.example.com/"]);
    const fenced = ok("```\nhttps://tracker.example/a\n```");
    expect(hrefs(fenced)).toEqual([]);
    expect(fenced.blocks[0]).toEqual({
      type: "code",
      text: "https://tracker.example/a",
      lang: null,
    });
    const inline = ok("`https://example.com`");
    expect(hrefs(inline)).toEqual([]);
    expect(inline.blocks[0]).toMatchObject({
      children: [{ type: "code", text: "https://example.com" }],
    });
  });

  it("does not keep image URLs", () => {
    const direct = ok("![alt](https://tracker.example/pixel.png)");
    expect(JSON.stringify(direct)).not.toContain("tracker.example");
    expect(direct.blocks[0]).toEqual({
      type: "paragraph",
      children: [{ type: "image", alt: "alt" }],
    });

    const referenced = ok("![alt][pic]\n\n[pic]: https://tracker.example/b.png\n\n[name][pic]");
    expect(referenced.blocks[0]).toEqual({
      type: "paragraph",
      children: [{ type: "image", alt: "alt" }],
    });
    expect(hrefs(referenced)).toEqual(["https://tracker.example/b.png"]);

    const imageOnly = ok("![shot][pic]\n\n[pic]: https://tracker.example/only.png");
    expect(JSON.stringify(imageOnly)).not.toContain("tracker.example");
    expect(imageOnly.blocks[0]).toEqual({
      type: "paragraph",
      children: [{ type: "image", alt: "shot" }],
    });
    expect(ok("![](https://tracker.example/x.png)").blocks).toEqual([]);
  });

  it("shows raw HTML as text", () => {
    const model = ok('<img src="https://tracker.example/c.png">');
    expect(model.blocks).toEqual([
      { type: "literal", text: '<img src="https://tracker.example/c.png">' },
    ]);
    expect(hrefs(model)).toEqual([]);
  });

  it("supports tables, strikethrough, and footnotes", () => {
    const table = ok("| a | b |\n| --- | --- |\n| 1 | `x` |");
    expect(table.blocks[0]).toMatchObject({
      type: "table",
      header: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]],
      rows: [[[{ type: "text", text: "1" }], [{ type: "code", text: "x" }]]],
    });

    const strike = ok("~~gone~~ and ~single~");
    expect(strike.blocks[0]).toMatchObject({
      children: [
        { type: "strike", children: [{ type: "text", text: "gone" }] },
        { type: "text", text: " and " },
        { type: "strike", children: [{ type: "text", text: "single" }] },
      ],
    });

    const notes = ok("See[^1].\n\n[^1]: The note.");
    expect(notes.blocks[0]).toMatchObject({
      children: [
        { type: "text", text: "See" },
        { type: "footnote", id: "fn-1", label: "1" },
        { type: "text", text: "." },
      ],
    });
    expect(notes.footnotes).toEqual([
      {
        id: "fn-1",
        label: "1",
        children: [{ type: "paragraph", children: [{ type: "text", text: "The note." }] }],
      },
    ]);
  });

  it("turns a soft break into a space and keeps a hard break", () => {
    expect(ok("hello\nworld").blocks[0]).toEqual({
      type: "paragraph",
      children: [{ type: "text", text: "hello world" }],
    });
    expect(ok("hello  \nworld").blocks[0]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", text: "hello" },
        { type: "break" },
        { type: "text", text: "world" },
      ],
    });
  });

  it("locates task markers and toggles only that marker", () => {
    const source = "# Todo\n\n- [ ] one\n* [x] two\n1. [X] three\n\n> - [ ] quoted\n- plain [ ]\n";
    const model = ok(source);
    const items = model.blocks.flatMap((block) => {
      if (block.type === "list") return block.items;
      if (block.type === "quote") {
        return block.children.flatMap((child) => (child.type === "list" ? child.items : []));
      }
      return [];
    });
    expect(items.map((item) => [item.checked, item.taskOffset])).toEqual([
      [false, source.indexOf("[ ] one") + 1],
      [true, source.indexOf("[x] two") + 1],
      [true, source.indexOf("[X] three") + 1],
      [false, source.indexOf("[ ] quoted") + 1],
      [null, null],
    ]);

    const first = items[0].taskOffset as number;
    const checked = toggleMarkdownTask(source, first, false);
    expect(checked).toBe(source.replace("- [ ] one", "- [x] one"));
    expect(toggleMarkdownTask(checked as string, first, true)).toBe(source);

    const upper = items[2].taskOffset as number;
    expect(toggleMarkdownTask(source, upper, true)).toBe(
      source.replace("1. [X] three", "1. [ ] three"),
    );
  });

  it("refuses a stale or out-of-range task toggle", () => {
    const source = "- [ ] one";
    const offset = source.indexOf("[ ]") + 1;
    expect(toggleMarkdownTask(source, offset, true)).toBeNull();
    expect(toggleMarkdownTask("- one", offset, false)).toBeNull();
    expect(toggleMarkdownTask(source, 0, false)).toBeNull();
    expect(toggleMarkdownTask(source, source.length, false)).toBeNull();
    expect(toggleMarkdownTask(source, 1.5, false)).toBeNull();
  });

  it("refuses to parse an oversized note", () => {
    const model = parseMarkdownDocument("a".repeat(MARKDOWN_PREVIEW_MAX_CHARS + 1));
    expect(model).toEqual({ status: "too_large" });
  });
});

describe("markdownOutline", () => {
  it("nests each heading under the nearest shallower one above it", () => {
    const source = "# Title\n\n## One\n\n#### Deep\n\n### Mid\n\n## Two\n\n# Next\n";
    expect(markdownOutline(source).entries.map(({ text, level }) => [text, level])).toEqual([
      ["Title", 0],
      ["One", 1],
      ["Deep", 2],
      ["Mid", 2],
      ["Two", 1],
      ["Next", 0],
    ]);
  });

  it("keeps plain text, the source offset, and skips nested or empty headings", () => {
    const source =
      "intro\n\n## **Bold** `code` [link](https://x.y)\n\n> # quoted\n\n#\n\nSetext\n===\n";
    const outline = markdownOutline(source).entries;
    expect(outline.map((entry) => entry.text)).toEqual(["Bold code link", "Setext"]);
    expect(outline[0]?.offset).toBe(source.indexOf("## "));
    expect(outline[0]?.depth).toBe(2);
    expect(outline[1]?.offset).toBe(source.indexOf("Setext"));
  });

  it("lists the same top-level headings the preview renders, in order", () => {
    const source = "# A\n\n- # in list\n\n## B\n\n[^1]\n\n[^1]: # in footnote\n";
    const model = ok(source);
    const previewHeadings = model.blocks.filter((block) => block.type === "heading");
    expect(markdownOutline(source).entries).toHaveLength(previewHeadings.length);
  });

  it("is empty for an oversized note", () => {
    expect(markdownOutline(`# a\n${"b".repeat(MARKDOWN_PREVIEW_MAX_CHARS)}`)).toEqual({
      status: "ok",
      entries: [],
    });
  });
});
