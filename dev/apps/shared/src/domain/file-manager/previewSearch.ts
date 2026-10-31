import { findTextMatches, type IndexedMatch } from "./fileSearch";
import type { MarkdownBlock, MarkdownInline, MarkdownPreviewModel } from "./markdownDocument";

/** A piece of Read view that shows text: an inline, a code block, or a literal block. */
export type PreviewTextNode =
  | Extract<MarkdownInline, { type: "text" | "code" | "image" }>
  | Extract<MarkdownBlock, { type: "code" | "literal" }>;

export interface PreviewSearch {
  /** Matches inside each piece of text Read view shows, numbered in reading order. */
  byNode: ReadonlyMap<PreviewTextNode, readonly IndexedMatch[]>;
  /**
   * The top-level piece holding each match, in match order: a block index, or
   * `blocks.length + n` for footnote `n`, so a view can scroll to it.
   */
  sectionOfMatch: readonly number[];
}

const NO_SEARCH: PreviewSearch = { byNode: new Map(), sectionOfMatch: [] };

function nodeText(node: PreviewTextNode): string {
  return node.type === "image" ? node.alt : node.text;
}

/**
 * Matches of `query` in what Read view shows, in reading order, so a renderer
 * can highlight each piece of text and jump to match `n`. A match does not
 * cross from one piece of text into the next (bold, a link, a line break).
 */
export function previewSearchMatches(model: MarkdownPreviewModel, query: string): PreviewSearch {
  if (model.status !== "ok" || !query.trim()) return NO_SEARCH;
  const byNode = new Map<PreviewTextNode, IndexedMatch[]>();
  const sectionOfMatch: number[] = [];

  const visitText = (node: PreviewTextNode, section: number) => {
    const found = findTextMatches(nodeText(node), query);
    if (found.length === 0) return;
    byNode.set(
      node,
      found.map((match) => {
        sectionOfMatch.push(section);
        return { ...match, index: sectionOfMatch.length - 1 };
      }),
    );
  };
  const visitInlines = (inlines: readonly MarkdownInline[], section: number) => {
    for (const inline of inlines) {
      switch (inline.type) {
        case "text":
        case "code":
        case "image":
          visitText(inline, section);
          break;
        case "strong":
        case "emphasis":
        case "strike":
        case "link":
          visitInlines(inline.children, section);
          break;
        default:
          break;
      }
    }
  };
  const visitBlocks = (blocks: readonly MarkdownBlock[], section: (index: number) => number) => {
    blocks.forEach((block, index) => {
      const at = section(index);
      switch (block.type) {
        case "paragraph":
        case "heading":
          visitInlines(block.children, at);
          break;
        case "code":
        case "literal":
          visitText(block, at);
          break;
        case "quote":
          visitBlocks(block.children, () => at);
          break;
        case "list":
          for (const item of block.items) visitBlocks(item.children, () => at);
          break;
        case "table":
          for (const cell of block.header) visitInlines(cell, at);
          for (const row of block.rows) for (const cell of row) visitInlines(cell, at);
          break;
        case "rule":
          break;
      }
    });
  };

  visitBlocks(model.blocks, (index) => index);
  model.footnotes.forEach((note, index) => {
    visitBlocks(note.children, () => model.blocks.length + index);
  });
  return { byNode, sectionOfMatch };
}
