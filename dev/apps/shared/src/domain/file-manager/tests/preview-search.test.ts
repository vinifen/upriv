import { describe, expect, it } from "vitest";
import { parseMarkdownNote } from "../markdownDocument";
import { previewSearchMatches } from "../previewSearch";

const parseMarkdownDocument = (source: string) => parseMarkdownNote(source).document;

describe("previewSearchMatches", () => {
  it("numbers matches in reading order and names the block holding each", () => {
    const model = parseMarkdownDocument(
      "# Cat heading\n\nA **cat** and a [cat](https://example.com).\n\n```\ncat code\n```\n",
    );
    const search = previewSearchMatches(model, "cat");
    expect(search.sectionOfMatch).toEqual([0, 1, 1, 2]);
    const numbered = [...search.byNode.values()].flat().map((match) => match.index);
    expect(numbered).toEqual([0, 1, 2, 3]);
  });

  it("finds text inside lists, quotes, and tables in their top-level block", () => {
    const model = parseMarkdownDocument(
      "- one fox\n- two\n\n> a fox\n\n| a | b |\n| - | - |\n| fox | x |\n",
    );
    expect(previewSearchMatches(model, "fox").sectionOfMatch).toEqual([0, 1, 2]);
  });

  it("places a footnote's match after the blocks", () => {
    const model = parseMarkdownDocument("Text[^1]\n\n[^1]: a fox note\n");
    if (model.status !== "ok") throw new Error("expected a parsed note");
    expect(previewSearchMatches(model, "fox").sectionOfMatch).toEqual([model.blocks.length]);
  });

  it("matches the alt text of an image and keeps offsets in that node's text", () => {
    const model = parseMarkdownDocument("![a red fox](fox.png)\n");
    const [[node, matches]] = [...previewSearchMatches(model, "fox").byNode.entries()];
    expect(node.type).toBe("image");
    expect(matches).toEqual([{ start: 6, end: 9, index: 0 }]);
  });

  it("finds nothing for a blank query or a note too large to parse", () => {
    const model = parseMarkdownDocument("fox\n");
    expect(previewSearchMatches(model, "  ").sectionOfMatch).toEqual([]);
    expect(previewSearchMatches({ status: "too_large" }, "fox").byNode.size).toBe(0);
  });
});
