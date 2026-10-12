import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { markdownLinkHref } from "./markdownLink";

/**
 * Above this, preview skips the parser and asks the user to switch to Code.
 * The source editor can still show the note (vault reads cap much higher).
 */
export const MARKDOWN_PREVIEW_MAX_CHARS = 256_000;

const FENCE_LANG = /^[A-Za-z0-9_+#.-]{1,32}$/;

export type MarkdownAlign = "left" | "center" | "right" | null;

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "emphasis"; children: MarkdownInline[] }
  | { type: "strike"; children: MarkdownInline[] }
  | { type: "link"; href: string; children: MarkdownInline[] }
  | { type: "image"; alt: string }
  | { type: "break" }
  | { type: "footnote"; id: string; label: string };

export interface MarkdownListItem {
  checked: boolean | null;
  /**
   * Source offset of the `x` / space inside a task marker (`[ ]`), for
   * {@link toggleMarkdownTask}. Null when the item is not a task or the marker
   * could not be located.
   */
  taskOffset: number | null;
  children: MarkdownBlock[];
}

export type MarkdownBlock =
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: "code"; text: string; lang: string | null }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | {
      type: "table";
      align: MarkdownAlign[];
      header: MarkdownInline[][];
      rows: MarkdownInline[][][];
    }
  | { type: "rule" }
  /** Raw HTML or other non-rendered source, shown as text. Never parsed as HTML. */
  | { type: "literal"; text: string };

export interface MarkdownFootnote {
  id: string;
  label: string;
  children: MarkdownBlock[];
}

export type MarkdownPreviewModel =
  | { status: "too_large" }
  | { status: "ok"; blocks: MarkdownBlock[]; footnotes: MarkdownFootnote[] };

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  label?: string | null;
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  align?: Array<string | null> | null;
  children?: MdNode[];
  position?: { start?: { offset?: number } };
}

interface ParseCtx {
  source: string;
  definitions: Map<string, string>;
  footnoteIndex: Map<string, number>;
  footnoteNodes: Map<string, MdNode>;
}

/**
 * CommonMark + GFM (tables, strikethrough, task lists, autolinks, footnotes)
 * as a document the UI can draw without HTML.
 *
 * Image URLs are dropped (alt text only) so a note cannot fetch a remote
 * resource by being opened. Links survive only when {@link markdownLinkHref}
 * accepts them. Unknown node types are omitted.
 */
type MarkdownTree = { tree: MdNode } | "too_large" | "unparsed";

/** One parse for Read and the outline, so a failure cannot disagree between them. */
function readMarkdownTree(source: string): MarkdownTree {
  if (source.length > MARKDOWN_PREVIEW_MAX_CHARS) return "too_large";
  try {
    return {
      tree: asTree(
        fromMarkdown(source, {
          extensions: [gfm({ singleTilde: true })],
          mdastExtensions: [gfmFromMarkdown()],
        }),
      ),
    };
  } catch {
    return "unparsed";
  }
}

export function parseMarkdownDocument(source: string): MarkdownPreviewModel {
  const read = readMarkdownTree(source);
  if (read === "too_large") return { status: "too_large" };
  if (read === "unparsed") {
    return {
      status: "ok",
      blocks: [{ type: "code", text: source, lang: null }],
      footnotes: [],
    };
  }
  const ctx = collect(read.tree, source);
  return {
    status: "ok",
    blocks: blocksFrom(read.tree.children, ctx),
    footnotes: footnotesFrom(ctx),
  };
}

export interface MarkdownOutlineEntry {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** Plain heading text (formatting dropped). */
  text: string;
  /** Indent under the nearest shallower heading above it; 0 for top level. */
  level: number;
  /** Source offset of the heading line, for jumping in Code view. */
  offset: number;
}

/**
 * `unparsed`: Read is showing the raw note, so the panel must not say the note
 * has no headings. `ok` with an empty list is a note that really has none,
 * including one over the preview cap.
 */
export interface MarkdownOutlineModel {
  status: "ok" | "unparsed";
  entries: MarkdownOutlineEntry[];
}

/**
 * Top-level headings in document order. Entry `i` is the `i`-th top-level
 * `heading` block of {@link parseMarkdownDocument} (same empty-heading rule),
 * so Read view can find it by position. Headings inside quotes, lists or
 * footnotes are not listed.
 */
export function markdownOutline(source: string): MarkdownOutlineModel {
  const read = readMarkdownTree(source);
  if (read === "unparsed") return { status: "unparsed", entries: [] };
  if (read === "too_large") return { status: "ok", entries: [] };
  return { status: "ok", entries: headingsFrom(read.tree, source) };
}

function headingsFrom(tree: MdNode, source: string): MarkdownOutlineEntry[] {
  const ctx = collect(tree, source);
  const entries: MarkdownOutlineEntry[] = [];
  const open: number[] = [];
  for (const node of tree.children ?? []) {
    if (node.type !== "heading") continue;
    const children = inlinesFrom(node.children, ctx);
    if (children.length === 0) continue;
    const depth = headingDepth(node.depth);
    while (open.length > 0 && (open[open.length - 1] ?? 0) >= depth) open.pop();
    entries.push({
      depth,
      text: inlineText(children).trim(),
      level: open.length,
      offset: node.position?.start?.offset ?? 0,
    });
    open.push(depth);
  }
  return entries;
}

function inlineText(nodes: MarkdownInline[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "code") out += node.text;
    else if (node.type === "image") out += node.alt;
    else if (node.type === "break") out += " ";
    else if ("children" in node) out += inlineText(node.children);
  }
  return out;
}

function asTree(value: unknown): MdNode {
  if (!value || typeof value !== "object") return { type: "root", children: [] };
  return value as MdNode;
}

function collect(root: MdNode, source: string): ParseCtx {
  const definitions = new Map<string, string>();
  const footnoteNodes = new Map<string, MdNode>();
  const seenRefs: string[] = [];
  const seen = new Set<string>();

  const visit = (node: MdNode) => {
    if (
      node.type === "definition" &&
      node.identifier &&
      node.url &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url);
    }
    if (
      node.type === "footnoteDefinition" &&
      node.identifier &&
      !footnoteNodes.has(node.identifier)
    ) {
      footnoteNodes.set(node.identifier, node);
    }
    if (node.type === "footnoteReference" && node.identifier && !seen.has(node.identifier)) {
      seen.add(node.identifier);
      seenRefs.push(node.identifier);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);

  const footnoteIndex = new Map<string, number>();
  let next = 1;
  for (const id of seenRefs) {
    if (footnoteNodes.has(id)) footnoteIndex.set(id, next++);
  }
  for (const id of footnoteNodes.keys()) {
    if (!footnoteIndex.has(id)) footnoteIndex.set(id, next++);
  }
  return { source, definitions, footnoteIndex, footnoteNodes };
}

function footnotesFrom(ctx: ParseCtx): MarkdownFootnote[] {
  const notes: MarkdownFootnote[] = [];
  for (const [identifier, node] of ctx.footnoteNodes) {
    const number = ctx.footnoteIndex.get(identifier);
    if (number == null) continue;
    notes.push({
      id: `fn-${number}`,
      label: String(number),
      children: blocksFrom(node.children, ctx),
    });
  }
  notes.sort((a, b) => Number(a.label) - Number(b.label));
  return notes;
}

function blocksFrom(nodes: MdNode[] | undefined, ctx: ParseCtx): MarkdownBlock[] {
  const out: MarkdownBlock[] = [];
  for (const node of nodes ?? []) {
    for (const block of blockFrom(node, ctx)) out.push(block);
  }
  return out;
}

function blockFrom(node: MdNode, ctx: ParseCtx): MarkdownBlock[] {
  switch (node.type) {
    case "paragraph":
      return paragraph(node.children, ctx);
    case "heading": {
      const children = inlinesFrom(node.children, ctx);
      if (children.length === 0) return [];
      return [{ type: "heading", depth: headingDepth(node.depth), children }];
    }
    case "code":
      return [{ type: "code", text: node.value ?? "", lang: fenceLang(node.lang) }];
    case "blockquote": {
      const children = blocksFrom(node.children, ctx);
      if (children.length === 0) return [];
      return [{ type: "quote", children }];
    }
    case "list":
      return listBlock(node, ctx);
    case "table":
      return tableBlock(node, ctx);
    case "thematicBreak":
      return [{ type: "rule" }];
    case "html":
    case "yaml":
      return node.value ? [{ type: "literal", text: node.value }] : [];
    case "definition":
    case "footnoteDefinition":
      return [];
    default:
      return paragraph([node], ctx);
  }
}

function paragraph(nodes: MdNode[] | undefined, ctx: ParseCtx): MarkdownBlock[] {
  const children = inlinesFrom(nodes, ctx);
  if (children.length === 0) return [];
  return [{ type: "paragraph", children }];
}

function listBlock(node: MdNode, ctx: ParseCtx): MarkdownBlock[] {
  const items: MarkdownListItem[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "listItem") continue;
    const checked = child.checked === true ? true : child.checked === false ? false : null;
    items.push({
      checked,
      taskOffset: checked === null ? null : taskMarkerOffset(child, checked, ctx.source),
      children: blocksFrom(child.children, ctx),
    });
  }
  if (items.length === 0) return [];
  const ordered = node.ordered === true;
  const start = ordered && node.start && node.start > 0 ? node.start : 1;
  return [{ type: "list", ordered, start, items }];
}

/** `- [ ]`, `* [x]`, `1. [X]` … right after the list item's bullet. */
const TASK_MARKER = /^(?:[*+-]|\d{1,9}[.)])[ \t]+\[([ xX])\]/;

function taskMarkerOffset(item: MdNode, checked: boolean, source: string): number | null {
  const start = item.position?.start?.offset;
  if (start == null) return null;
  const match = TASK_MARKER.exec(source.slice(start, start + 32));
  if (!match) return null;
  const offset = start + match[0].length - 2;
  return isTaskMark(source[offset], checked) ? offset : null;
}

function isTaskMark(char: string | undefined, checked: boolean): boolean {
  return checked ? char === "x" || char === "X" : char === " ";
}

/**
 * Flip the task marker at `offset` (from {@link MarkdownListItem.taskOffset}).
 * Returns null when the source no longer has the expected marker there, so a
 * stale preview cannot rewrite some other character.
 */
export function toggleMarkdownTask(
  source: string,
  offset: number,
  checked: boolean,
): string | null {
  if (!Number.isInteger(offset) || offset < 1 || offset >= source.length - 1) return null;
  if (source[offset - 1] !== "[" || source[offset + 1] !== "]") return null;
  if (!isTaskMark(source[offset], checked)) return null;
  return `${source.slice(0, offset)}${checked ? " " : "x"}${source.slice(offset + 1)}`;
}

function tableBlock(node: MdNode, ctx: ParseCtx): MarkdownBlock[] {
  const align = (node.align ?? []).map(alignValue);
  const rows: MarkdownInline[][][] = [];
  for (const row of node.children ?? []) {
    if (row.type !== "tableRow") continue;
    const cells: MarkdownInline[][] = [];
    for (const cell of row.children ?? []) {
      if (cell.type !== "tableCell") continue;
      cells.push(inlinesFrom(cell.children, ctx));
    }
    rows.push(cells);
  }
  const header = rows[0];
  if (!header) return [];
  return [{ type: "table", align, header, rows: rows.slice(1) }];
}

function alignValue(value: string | null): MarkdownAlign {
  if (value === "left" || value === "center" || value === "right") return value;
  return null;
}

function headingDepth(depth: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  if (depth === 1 || depth === 2 || depth === 3 || depth === 4 || depth === 5 || depth === 6) {
    return depth;
  }
  return 1;
}

function fenceLang(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const trimmed = lang.trim();
  return FENCE_LANG.test(trimmed) ? trimmed : null;
}

function inlinesFrom(nodes: MdNode[] | undefined, ctx: ParseCtx): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  for (const node of nodes ?? []) {
    for (const part of inlineParts(node, ctx)) pushInline(out, part);
  }
  return out;
}

function inlineParts(node: MdNode, ctx: ParseCtx): MarkdownInline[] {
  switch (node.type) {
    case "text":
      return [{ type: "text", text: (node.value ?? "").replace(/\n/g, " ") }];
    case "html":
      return node.value ? [{ type: "text", text: node.value.replace(/\n/g, " ") }] : [];
    case "inlineCode":
      return [{ type: "code", text: node.value ?? "" }];
    case "break":
      return [{ type: "break" }];
    case "emphasis":
    case "strong":
    case "delete":
      return wrapInline(node, ctx);
    case "link":
    case "linkReference":
      return linkInline(node, ctx);
    case "image":
    case "imageReference":
      return imageInline(node);
    case "footnoteReference":
      return footnoteInline(node, ctx);
    default:
      return [];
  }
}

function wrapInline(node: MdNode, ctx: ParseCtx): MarkdownInline[] {
  const children = inlinesFrom(node.children, ctx);
  if (children.length === 0) return [];
  if (node.type === "strong") return [{ type: "strong", children }];
  if (node.type === "delete") return [{ type: "strike", children }];
  return [{ type: "emphasis", children }];
}

function linkInline(node: MdNode, ctx: ParseCtx): MarkdownInline[] {
  const raw = node.type === "link" ? node.url : definedUrl(node, ctx);
  const href = raw ? markdownLinkHref(raw) : null;
  const children = inlinesFrom(node.children, ctx);
  if (!href) return children;
  if (children.length === 0) {
    return [{ type: "link", href, children: [{ type: "text", text: href }] }];
  }
  return [{ type: "link", href, children }];
}

function definedUrl(node: MdNode, ctx: ParseCtx): string | undefined {
  if (!node.identifier) return undefined;
  return ctx.definitions.get(node.identifier);
}

function imageInline(node: MdNode): MarkdownInline[] {
  const alt = node.alt ?? "";
  if (!alt.trim()) return [];
  return [{ type: "image", alt }];
}

function footnoteInline(node: MdNode, ctx: ParseCtx): MarkdownInline[] {
  const number = node.identifier ? ctx.footnoteIndex.get(node.identifier) : undefined;
  if (number == null) {
    const marker = node.label || node.identifier || "";
    return marker ? [{ type: "text", text: `[${marker}]` }] : [];
  }
  return [{ type: "footnote", id: `fn-${number}`, label: String(number) }];
}

function pushInline(out: MarkdownInline[], next: MarkdownInline): void {
  if (next.type === "text") {
    if (!next.text) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") {
      prev.text += next.text;
      return;
    }
  }
  out.push(next);
}
