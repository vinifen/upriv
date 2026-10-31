import { describe, expect, it, vi } from "vitest";

vi.mock("mdast-util-from-markdown", () => ({
  fromMarkdown: () => {
    throw new Error("boom");
  },
}));

import { parseMarkdownNote } from "../markdownDocument";

const parseMarkdownDocument = (source: string) => parseMarkdownNote(source).document;

describe("markdown parse failure", () => {
  it("shows the raw note in Read and does not claim the outline is empty", () => {
    const source = "# Still here\n";
    expect(parseMarkdownNote(source).outline).toEqual({ status: "unparsed", entries: [] });
    expect(parseMarkdownDocument(source)).toEqual({
      status: "ok",
      blocks: [{ type: "code", text: source, lang: null }],
      footnotes: [],
    });
  });
});
