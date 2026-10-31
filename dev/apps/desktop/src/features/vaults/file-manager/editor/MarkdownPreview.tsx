import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  activeOutlineIndex,
  findTextMatches,
  MARKDOWN_COPY_DOUBLE_TAP_MS,
  toggleMarkdownTask,
  type MarkdownAlign,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownListItem,
  type MarkdownParser,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

const COPIED_MS = 1600;

interface MarkdownPreviewProps {
  markdown: string;
  parser: MarkdownParser;
  onCopyFailed: () => void;
  /** Task checkbox edits. Omit for a read-only note (checkboxes stay disabled). */
  onChange?: (markdown: string) => void;
  searchQuery?: string;
  searchActiveIndex?: number;
  onMatchCountChange?: (count: number) => void;
  onActiveHeadingChange?: (index: number) => void;
}

interface PreviewActions {
  copiedKey: string | null;
  copy: (key: string, text: string) => void;
  /** Copies on the second click of the same value within `MARKDOWN_COPY_DOUBLE_TAP_MS`. */
  copyOnSecondClick: (key: string, text: string) => void;
  copyLabel: string;
  copiedLabel: string;
  onFootnote: (id: string) => void;
  noteRef: (id: string, node: HTMLElement | null) => void;
  toggleTask: ((offset: number, checked: boolean) => void) | null;
}

export interface MarkdownPreviewHandle {
  /** Index into `markdownOutline` — the n-th top-level heading. */
  scrollToHeading: (index: number) => void;
  /** Scroll to match at index. */
  scrollToMatch: (index: number) => void;
}

const MATCH_HIGHLIGHT = "file-search-match";
const ACTIVE_HIGHLIGHT = "file-search-active";

/** Rendered text that matches `query`, skipping controls and decorative labels. */
function findTextRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("button, .select-none")) continue;
    for (const match of findTextMatches(node.textContent ?? "", query)) {
      const range = document.createRange();
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      ranges.push(range);
    }
  }
  return ranges;
}

function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/**
 * Highlight names are global. Every file manager stays mounted, so remove a
 * name only while it still holds this preview's ranges.
 */
function deleteOwnHighlight(name: string, own: Highlight) {
  if (CSS.highlights.get(name) === own) CSS.highlights.delete(name);
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(
  function MarkdownPreview(props, ref) {
    return <MarkdownPreviewBody {...props} handleRef={ref} />;
  },
);

function MarkdownPreviewBody({
  markdown,
  parser,
  onCopyFailed,
  onChange,
  searchQuery,
  searchActiveIndex = 0,
  onMatchCountChange,
  onActiveHeadingChange,
  handleRef,
}: MarkdownPreviewProps & { handleRef: ForwardedRef<MarkdownPreviewHandle> }) {
  const { t } = useTranslation();
  const model = useMemo(() => parser.note(markdown).document, [markdown, parser]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const matchRangesRef = useRef<Range[]>([]);
  const lastMatchCountRef = useRef<number>(-1);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToHeading: (index) => {
        const scroller = scrollerRef.current;
        const heading = scroller?.querySelectorAll<HTMLElement>("[data-outline-heading]")[index];
        if (!scroller || !heading) return;
        const top =
          heading.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        scroller.scrollTo?.({ top: Math.max(0, top - 4), behavior: "smooth" });
      },
      scrollToMatch: (index) => {
        const scroller = scrollerRef.current;
        const range = matchRangesRef.current[index];
        if (!scroller || !range) return;
        const rect = range.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const top = rect.top - scrollerRect.top + scroller.scrollTop;
        scroller.scrollTo?.({
          top: Math.max(0, top - scrollerRect.height / 3),
          behavior: "smooth",
        });
      },
    }),
    [],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    const query = searchQuery?.trim();
    const ranges = root && query ? findTextRanges(root, query) : [];
    matchRangesRef.current = ranges;
    if (lastMatchCountRef.current !== ranges.length) {
      lastMatchCountRef.current = ranges.length;
      onMatchCountChange?.(ranges.length);
    }
    if (ranges.length === 0 || !highlightsSupported()) return;

    const matchHighlight = new Highlight();
    const activeHighlight = new Highlight();
    ranges.forEach((range, index) => {
      (index === searchActiveIndex ? activeHighlight : matchHighlight).add(range);
    });
    CSS.highlights.set(MATCH_HIGHLIGHT, matchHighlight);
    CSS.highlights.set(ACTIVE_HIGHLIGHT, activeHighlight);
    return () => {
      deleteOwnHighlight(MATCH_HIGHLIGHT, matchHighlight);
      deleteOwnHighlight(ACTIVE_HIGHLIGHT, activeHighlight);
    };
  }, [markdown, searchQuery, searchActiveIndex, onMatchCountChange]);

  /* Track the current visible top heading as the user scrolls. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !onActiveHeadingChange) return;

    let rafId = 0;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const headings = scroller.querySelectorAll<HTMLElement>("[data-outline-heading]");
        const contentTop = scroller.getBoundingClientRect().top - scroller.scrollTop;
        const tops = Array.from(
          headings,
          (heading) => heading.getBoundingClientRect().top - contentTop,
        );
        onActiveHeadingChange(
          activeOutlineIndex(tops, {
            offset: scroller.scrollTop,
            viewport: scroller.clientHeight,
            content: scroller.scrollHeight,
          }),
        );
      });
    };

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [markdown, onActiveHeadingChange]);
  const notes = useRef(new Map<string, HTMLElement>());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyGeneration = useRef(0);
  const lastClick = useRef<{ key: string; at: number } | null>(null);
  const seenMarkdown = useRef<string | null>(null);

  useEffect(
    () => () => {
      copyGeneration.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const previous = seenMarkdown.current;
    seenMarkdown.current = markdown;
    if (previous === null || previous === markdown) return;
    copyGeneration.current += 1;
    setCopiedKey(null);
  }, [markdown]);

  const copy = (key: string, text: string) => {
    const generation = copyGeneration.current;
    void navigator.clipboard.writeText(text).then(
      () => {
        if (generation !== copyGeneration.current) return;
        setCopiedKey(key);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current));
        }, COPIED_MS);
      },
      () => {
        if (generation !== copyGeneration.current) return;
        onCopyFailed();
      },
    );
  };

  const copyOnSecondClick = (key: string, text: string) => {
    const now = Date.now();
    const previous = lastClick.current;
    if (previous && previous.key === key && now - previous.at < MARKDOWN_COPY_DOUBLE_TAP_MS) {
      lastClick.current = null;
      copy(key, text);
      return;
    }
    lastClick.current = { key, at: now };
  };

  const actions: PreviewActions = {
    copiedKey,
    copy,
    copyOnSecondClick,
    copyLabel: t("modal.file_manager.markdown.copy"),
    copiedLabel: t("modal.file_manager.markdown.copied"),
    onFootnote: (id) => {
      const scroller = scrollerRef.current;
      const note = notes.current.get(id);
      if (!scroller || !note) return;
      const top =
        note.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      scroller.scrollTo?.({ top, behavior: "smooth" });
    },
    noteRef: (id, node) => {
      if (node) notes.current.set(id, node);
      else notes.current.delete(id);
    },
    toggleTask: onChange
      ? (offset, checked) => {
          const next = toggleMarkdownTask(markdown, offset, checked);
          if (next !== null) onChange(next);
        }
      : null,
  };

  if (model.status === "too_large") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-container-high px-6 text-center">
        <p className="max-w-sm text-sm text-on-surface-variant">
          {t("modal.file_manager.markdown.too_large")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-auto bg-surface-container-high px-4 pb-3 pt-1 text-sm leading-6 text-on-surface select-text"
    >
      <Blocks blocks={model.blocks} actions={actions} path="doc" />
      {model.footnotes.length > 0 ? (
        <section className="mt-6 border-t border-outline-variant pt-3">
          <h2 className="mb-2 text-sm font-semibold text-on-surface">
            {t("modal.file_manager.markdown.footnotes")}
          </h2>
          <ol className="space-y-2">
            {model.footnotes.map((note) => (
              <li
                key={note.id}
                ref={(node) => actions.noteRef(note.id, node)}
                className="text-sm text-on-surface"
                value={Number(note.label)}
              >
                <Blocks blocks={note.children} actions={actions} path={note.id} nested />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Blocks({
  blocks,
  actions,
  path,
  nested = false,
}: {
  blocks: MarkdownBlock[];
  actions: PreviewActions;
  path: string;
  nested?: boolean;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block
          key={`${block.type}-${index}`}
          block={block}
          actions={actions}
          path={`${path}-${index}`}
          nested={nested}
        />
      ))}
    </>
  );
}

function Block({
  block,
  actions,
  path,
  nested,
}: {
  block: MarkdownBlock;
  actions: PreviewActions;
  path: string;
  nested: boolean;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className={nested ? "mb-1 last:mb-0" : "mb-3 last:mb-0"}>
          <Inlines nodes={block.children} actions={actions} keyPrefix={path} />
        </p>
      );
    case "heading":
      return (
        <Heading depth={block.depth} outlineAnchor={!nested}>
          <Inlines nodes={block.children} actions={actions} keyPrefix={path} />
        </Heading>
      );
    case "code":
      return <CodeBlock text={block.text} lang={block.lang} actions={actions} copyKey={path} />;
    case "quote":
      return (
        <blockquote className="mb-3 border-l-2 border-accent/60 pl-3 text-on-surface">
          <Blocks blocks={block.children} actions={actions} path={path} nested />
        </blockquote>
      );
    case "list":
      return <ListBlock block={block} actions={actions} path={path} />;
    case "table":
      return <TableBlock block={block} actions={actions} path={path} />;
    case "rule":
      return <hr className="my-3 border-0 border-t border-outline-variant first:mt-1" />;
    case "literal":
      return (
        <pre className="mb-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-on-surface">
          {block.text}
        </pre>
      );
    default:
      return null;
  }
}

/** `outlineAnchor`: top-level heading, listed in the outline (nested ones are not). */
function Heading({
  depth,
  outlineAnchor,
  children,
}: {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  outlineAnchor: boolean;
  children: ReactNode;
}) {
  const size =
    depth === 1 ? "text-xl" : depth === 2 ? "text-lg" : depth === 3 ? "text-base" : "text-sm";
  const props = {
    className: `${size} mb-2 mt-3 font-semibold text-on-surface first:mt-0`,
    "data-outline-heading": outlineAnchor ? "" : undefined,
  };
  if (depth === 1) return <h1 {...props}>{children}</h1>;
  if (depth === 2) return <h2 {...props}>{children}</h2>;
  if (depth === 3) return <h3 {...props}>{children}</h3>;
  if (depth === 4) return <h4 {...props}>{children}</h4>;
  if (depth === 5) return <h5 {...props}>{children}</h5>;
  return <h6 {...props}>{children}</h6>;
}

function ListBlock({
  block,
  actions,
  path,
}: {
  block: Extract<MarkdownBlock, { type: "list" }>;
  actions: PreviewActions;
  path: string;
}) {
  const items = block.items.map((item, index) => {
    const marker = block.start + index;
    return (
      <li key={marker} className={item.checked === null ? undefined : "list-none"}>
        {item.checked === null ? (
          <Blocks blocks={item.children} actions={actions} path={`${path}-${index}`} nested />
        ) : (
          <div className="flex items-start gap-2">
            <TaskCheckbox checked={item.checked} onToggle={taskToggle(actions, item)} />
            <div className="min-w-0 flex-1">
              <Blocks blocks={item.children} actions={actions} path={`${path}-${index}`} nested />
            </div>
          </div>
        )}
      </li>
    );
  });
  const className = "mb-3 space-y-1 pl-5 last:mb-0";
  if (block.ordered) {
    return (
      <ol className={`${className} list-decimal`} start={block.start}>
        {items}
      </ol>
    );
  }
  return <ul className={`${className} list-disc`}>{items}</ul>;
}

function taskToggle(actions: PreviewActions, item: MarkdownListItem): (() => void) | null {
  const { toggleTask } = actions;
  const { taskOffset, checked } = item;
  if (!toggleTask || taskOffset === null || checked === null) return null;
  return () => toggleTask(taskOffset, checked);
}

function TaskCheckbox({ checked, onToggle }: { checked: boolean; onToggle: (() => void) | null }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={!onToggle}
      onClick={onToggle ?? undefined}
      className={[
        "mt-1 inline-flex size-3.5 shrink-0 select-none items-center justify-center rounded-[3px] border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        onToggle ? "cursor-pointer hover:border-accent" : "cursor-default",
        checked ? "border-accent bg-accent text-accent-foreground" : "border-outline-variant",
      ].join(" ")}
    >
      {checked ? <span className="text-[10px] leading-none">✓</span> : null}
    </button>
  );
}

function TableBlock({
  block,
  actions,
  path,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  actions: PreviewActions;
  path: string;
}) {
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th
                key={index}
                className={`border border-outline-variant bg-surface-container-highest px-2 py-1 font-medium ${alignClass(block.align[index] ?? null)}`}
              >
                <Inlines nodes={cell} actions={actions} keyPrefix={`${path}-h-${index}`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`border border-outline-variant px-2 py-1 align-top ${alignClass(block.align[index] ?? null)}`}
                >
                  <Inlines
                    nodes={cell}
                    actions={actions}
                    keyPrefix={`${path}-${rowIndex}-${index}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function alignClass(align: MarkdownAlign): string {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

/** A second click copies the whole value; a fast second press must not select a word first. */
function secondClickCopyProps(actions: PreviewActions, copyKey: string, text: string) {
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.detail > 1) event.preventDefault();
    },
    onClick: () => actions.copyOnSecondClick(copyKey, text),
  };
}

function CodeBlock({
  text,
  lang,
  actions,
  copyKey,
}: {
  text: string;
  lang: string | null;
  actions: PreviewActions;
  copyKey: string;
}) {
  const copied = actions.copiedKey === copyKey;
  return (
    <div
      className={[
        "relative mb-3 overflow-hidden rounded-lg bg-surface-container-highest ring-inset transition-shadow",
        copied ? "ring-1 ring-accent" : "",
      ].join(" ")}
    >
      {lang ? (
        <div className="select-none px-3 pt-2 font-mono text-[10px] uppercase tracking-wide text-on-surface-variant">
          {lang}
        </div>
      ) : null}
      <pre
        {...secondClickCopyProps(actions, copyKey, text)}
        className={[
          "overflow-x-auto pb-3 pl-3 pr-20 font-mono text-[13px] leading-5 whitespace-pre text-on-surface",
          lang ? "pt-1" : "pt-3",
        ].join(" ")}
      >
        {text}
      </pre>
      <button
        type="button"
        aria-live="polite"
        onClick={() => actions.copy(copyKey, text)}
        className={[
          "absolute right-2 top-2 inline-flex select-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
          "hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          copied ? "text-accent" : "text-on-surface-variant",
        ].join(" ")}
      >
        <Icon name="copy" size={12} />
        {copied ? actions.copiedLabel : actions.copyLabel}
      </button>
    </div>
  );
}

function Inlines({
  nodes,
  actions,
  keyPrefix,
}: {
  nodes: MarkdownInline[];
  actions: PreviewActions;
  keyPrefix: string;
}) {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline
          key={`${keyPrefix}-${index}`}
          node={node}
          copyKey={`${keyPrefix}-${index}`}
          actions={actions}
        />
      ))}
    </>
  );
}

function Inline({
  node,
  copyKey,
  actions,
}: {
  node: MarkdownInline;
  copyKey: string;
  actions: PreviewActions;
}) {
  switch (node.type) {
    case "text":
      return node.text;
    case "break":
      return <br />;
    case "strong":
      return (
        <strong className="font-semibold">
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-s`} />
        </strong>
      );
    case "emphasis":
      return (
        <em>
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-e`} />
        </em>
      );
    case "strike":
      return (
        <s>
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-d`} />
        </s>
      );
    case "link":
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline decoration-accent/40 underline-offset-2"
        >
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-a`} />
        </a>
      );
    case "image":
      return <span className="italic text-on-surface-variant">{node.alt}</span>;
    case "footnote":
      return (
        <button
          type="button"
          onClick={() => actions.onFootnote(node.id)}
          className="mx-0.5 align-super text-[10px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {node.label}
        </button>
      );
    case "code": {
      const copied = actions.copiedKey === copyKey;
      const label = copied ? actions.copiedLabel : actions.copyLabel;
      return (
        <span
          className={[
            "inline max-w-full rounded bg-surface-container-highest px-1 align-baseline transition-shadow",
            copied ? "ring-1 ring-accent" : "",
          ].join(" ")}
        >
          <code
            {...secondClickCopyProps(actions, copyKey, node.text)}
            className="break-all font-mono text-[13px] whitespace-pre-wrap text-on-surface"
          >
            {node.text}
          </code>
          <button
            type="button"
            aria-label={label}
            title={label}
            onClick={() => actions.copy(copyKey, node.text)}
            className="ml-0.5 inline-flex shrink-0 translate-y-0.5 select-none items-center justify-center rounded-sm text-on-surface-variant hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon name="copy" size={12} className={copied ? "text-accent" : undefined} />
          </button>
        </span>
      );
    }
    default:
      return null;
  }
}
