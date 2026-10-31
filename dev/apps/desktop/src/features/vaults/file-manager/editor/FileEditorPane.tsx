import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "@/i18n";
import {
  activeOutlineIndex,
  createMarkdownParser,
  editorBlocks,
  fileBaseName,
  fileEditorWordWrap,
  fileMarkdownOutlineOpen,
  fileMarkdownView,
  fileSearchQuery,
  findTextMatches,
  lineStartOffsets,
  MARKDOWN_OUTLINE_SETTLE_MS,
  spanAt,
  stepMatchIndex,
  vaultFileLanguageFromPath,
  type TextMatch,
} from "@upriv/shared";
import { useOutlineHeading, useSettledValue, useValueAfterPaint } from "@upriv/shared/react";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { allowFileManagerDrop, beginOsFileImport } from "../lib/osFileDrop";
import { osFileImportParentPath } from "../lib/osFileImportTarget";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { EditorPathBar } from "./EditorPathBar";
import { FileEditorSearch, type FileEditorSearchHandle } from "./FileEditorSearch";
import { MarkdownOutlinePanel, MarkdownOutlineToggle } from "./MarkdownOutline";
import { MarkdownPreview, type MarkdownPreviewHandle } from "./MarkdownPreview";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import { WordWrapToggle } from "./WordWrapToggle";

interface FileEditorPaneProps {
  fm: FileManagerApi;
  /** Vault display name — first crumb of the path row. */
  vaultName: string;
  /** The file manager on screen. Hidden ones stay mounted and ignore keyboard shortcuts. */
  active: boolean;
}

const EDITOR_LINE_CLASS = "font-mono text-[13px] leading-5";
/** `leading-5` in px: one unwrapped line. */
const EDITOR_LINE_PX = 20;
const GUTTER_INSET = "0.5rem";
const GUTTER_TEXT_GAP = "0.75rem";

const MIRROR_STYLE_PROPS = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "tabSize",
  "wordSpacing",
] as const;

/**
 * Tops of the lines holding each offset (ascending), in one layout pass. A
 * wrapping textarea is measured through a hidden copy of its text.
 */
function textareaLineTops(
  textarea: HTMLTextAreaElement,
  offsets: readonly number[],
  wordWrap = true,
): number[] {
  const text = textarea.value;
  if (!wordWrap) {
    const tops: number[] = [];
    let line = 0;
    let at = 0;
    for (const offset of offsets) {
      for (const end = Math.min(offset, text.length); at < end; at++) {
        if (text[at] === "\n") line++;
      }
      tops.push(line * EDITOR_LINE_PX);
    }
    return tops;
  }
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const prop of MIRROR_STYLE_PROPS) mirror.style[prop] = style[prop];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-99999px",
    boxSizing: "border-box",
    width: `${textarea.clientWidth}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  const markers: HTMLSpanElement[] = [];
  let from = 0;
  for (const offset of offsets) {
    mirror.append(text.slice(from, offset));
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.append(marker);
    markers.push(marker);
    from = offset;
  }
  document.body.appendChild(mirror);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const tops = markers.map((marker) => marker.offsetTop - paddingTop);
  mirror.remove();
  return tops;
}

function textareaLineTop(textarea: HTMLTextAreaElement, offset: number, wordWrap = true): number {
  return textareaLineTops(textarea, [offset], wordWrap)[0] ?? 0;
}

function jumpTextareaTo(textarea: HTMLTextAreaElement, offset: number, wordWrap = true) {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(offset, offset);
  textarea.scrollTo?.({
    top: Math.max(0, textareaLineTop(textarea, offset, wordWrap)),
    behavior: "smooth",
  });
}

interface WrappedGutterLineProps {
  lineNumber: number;
  lineText: string;
  gutterWidthCh: number;
}

const WrappedGutterLine = memo(function WrappedGutterLine({
  lineNumber,
  lineText,
  gutterWidthCh,
}: WrappedGutterLineProps) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="visible absolute top-0 text-right select-none"
        style={{
          left: `calc(-1 * (${gutterWidthCh}ch + ${GUTTER_TEXT_GAP}))`,
          width: `${gutterWidthCh}ch`,
        }}
      >
        <span className="font-mono text-[9px] leading-5 tabular-nums text-[var(--editor-gutter-muted)]">
          {lineNumber}
        </span>
      </div>
      {lineText || "\u200b"}
    </div>
  );
});

interface GutterBlockProps {
  firstLine: number;
  text: string;
  /** Near the viewport. A block further away has no line numbers to show. */
  numbered: boolean;
  gutterWidthCh: number;
}

/**
 * Lines of the wrapped gutter's copy of the text. Each line is its own element
 * only near the viewport. A block further away is one text node that wraps to
 * the same height, so the numbers stay lined up with far fewer elements.
 */
const GutterBlock = memo(function GutterBlock({
  firstLine,
  text,
  numbered,
  gutterWidthCh,
}: GutterBlockProps) {
  if (numbered) {
    return (
      <div>
        {text.split("\n").map((lineText, index) => (
          <WrappedGutterLine
            key={index}
            lineNumber={firstLine + index + 1}
            lineText={lineText}
            gutterWidthCh={gutterWidthCh}
          />
        ))}
      </div>
    );
  }
  // A last line that is empty has no row of its own without a character on it.
  return <div>{text === "" || text.endsWith("\n") ? `${text}\u200b` : text}</div>;
});

interface EditorWithLineNumbersProps {
  content: string;
  /**
   * `content` as the line numbers and search highlights draw it. It trails a
   * fast typist by a render, so a key reaches the textarea first.
   */
  shownContent: string;
  fileName: string;
  ariaLabel: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** Search matches in `shownContent`, highlighted behind the text. */
  matches: readonly TextMatch[];
  searchActiveIndex?: number;
  wordWrap?: boolean;
  onScroll?: () => void;
  onSelect?: () => void;
}

function EditorWithLineNumbers({
  content,
  shownContent,
  fileName,
  ariaLabel,
  readOnly = false,
  onChange,
  textareaRef,
  matches,
  searchActiveIndex = 0,
  wordWrap = true,
  onScroll,
  onSelect,
}: EditorWithLineNumbersProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const lineStarts = useMemo(() => lineStartOffsets(shownContent), [shownContent]);
  const lines = lineStarts.length;
  const blocks = useMemo(
    () => (wordWrap ? editorBlocks(shownContent, lineStarts) : []),
    [lineStarts, shownContent, wordWrap],
  );
  const lineNumbersText = useMemo(
    () =>
      wordWrap ? "" : Array.from({ length: lines }, (_, index) => String(index + 1)).join("\n"),
    [lines, wordWrap],
  );
  const [numberedBlocks, setNumberedBlocks] = useState({ first: 0, last: 1 });

  /** Number the blocks within one viewport of the screen. */
  const updateNumberedBlocks = useCallback(() => {
    const textarea = textareaRef.current;
    const gutter = gutterRef.current;
    if (!textarea || !gutter || !wordWrap) return;
    const tops = Array.from(gutter.children, (block) => (block as HTMLElement).offsetTop);
    const first = spanAt(tops, textarea.scrollTop - textarea.clientHeight);
    const last = spanAt(tops, textarea.scrollTop + 2 * textarea.clientHeight);
    setNumberedBlocks((current) =>
      current.first === first && current.last === last ? current : { first, last },
    );
  }, [textareaRef, wordWrap]);

  const syncScroll = () => {
    if (textareaRef.current) {
      if (gutterRef.current) {
        gutterRef.current.scrollTop = textareaRef.current.scrollTop;
      }
      if (backdropRef.current) {
        backdropRef.current.scrollTop = textareaRef.current.scrollTop;
        backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
      updateNumberedBlocks();
      onScroll?.();
    }
  };

  const highlightedSegments = useMemo(() => {
    if (matches.length === 0) return null;
    const segments: ReactNode[] = [];
    let lastIndex = 0;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (match.start > lastIndex) {
        segments.push(
          <span key={`text-${lastIndex}`} className="text-transparent">
            {shownContent.slice(lastIndex, match.start)}
          </span>,
        );
      }
      const isActive = i === searchActiveIndex;
      segments.push(
        <mark
          key={`match-${match.start}`}
          className={[
            "rounded-[2px] p-0 m-0 text-transparent select-none",
            isActive
              ? "bg-[color-mix(in_srgb,var(--accent)_70%,transparent)] ring-1 ring-accent"
              : "bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]",
          ].join(" ")}
        >
          {shownContent.slice(match.start, match.end)}
        </mark>,
      );
      lastIndex = match.end;
    }
    if (lastIndex < shownContent.length) {
      segments.push(
        <span key={`text-${lastIndex}`} className="text-transparent">
          {shownContent.slice(lastIndex)}
        </span>,
      );
    }
    return segments;
  }, [shownContent, matches, searchActiveIndex]);

  // Line numbers, highlights, and the scrollbar width follow the drawn text,
  // so they are lined up again only when it, the wrap, or the highlights change.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
      if (wordWrap) {
        const scrollbarWidth = textarea.offsetWidth - textarea.clientWidth;
        gutterRef.current.style.right = `${scrollbarWidth}px`;
      } else {
        gutterRef.current.style.right = "";
      }
    }
    if (backdropRef.current) {
      backdropRef.current.scrollTop = textarea.scrollTop;
      backdropRef.current.scrollLeft = textarea.scrollLeft;
      const scrollbarWidth = textarea.offsetWidth - textarea.clientWidth;
      backdropRef.current.style.right = `${scrollbarWidth}px`;
    }
    updateNumberedBlocks();
  }, [textareaRef, shownContent, wordWrap, highlightedSegments, updateNumberedBlocks]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (textareaRef.current) {
        const scrollbarWidth = textareaRef.current.offsetWidth - textareaRef.current.clientWidth;
        if (backdropRef.current) {
          backdropRef.current.style.right = `${scrollbarWidth}px`;
          backdropRef.current.scrollTop = textareaRef.current.scrollTop;
          backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
        if (gutterRef.current) {
          if (wordWrap) {
            gutterRef.current.style.right = `${scrollbarWidth}px`;
          }
          gutterRef.current.scrollTop = textareaRef.current.scrollTop;
        }
        updateNumberedBlocks();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [textareaRef, updateNumberedBlocks, wordWrap]);

  const gutterWidthCh = Math.max(2, String(lines).length);

  return (
    <div
      className={[
        "relative min-h-0 flex-1 overflow-hidden bg-surface-container-high",
        EDITOR_LINE_CLASS,
      ].join(" ")}
    >
      {/* Opaque gutter background column pinning line numbers on the left */}
      <div
        aria-hidden
        className={[
          "pointer-events-none absolute bottom-0 left-0 top-0 z-10 bg-surface-container-high select-none",
          EDITOR_LINE_CLASS,
        ].join(" ")}
        style={{
          width: `calc(${GUTTER_INSET} + ${gutterWidthCh}ch + (${GUTTER_TEXT_GAP} / 2))`,
        }}
      />
      {wordWrap ? (
        <div
          ref={gutterRef}
          aria-hidden
          className={[
            "pointer-events-none absolute inset-y-0 left-0 right-0 z-20 overflow-hidden invisible bg-transparent pb-2 pr-4 pt-1 outline-none select-none md:pr-5",
            "whitespace-pre-wrap break-words",
            EDITOR_LINE_CLASS,
          ].join(" ")}
          style={{
            paddingLeft: `calc(${GUTTER_INSET} + ${gutterWidthCh}ch + ${GUTTER_TEXT_GAP})`,
          }}
        >
          {blocks.map((block, index) => (
            <GutterBlock
              key={block.firstLine}
              firstLine={block.firstLine}
              text={block.text}
              numbered={index >= numberedBlocks.first && index <= numberedBlocks.last}
              gutterWidthCh={gutterWidthCh}
            />
          ))}
        </div>
      ) : (
        <div
          ref={gutterRef}
          aria-hidden
          className="pointer-events-none absolute bottom-0 top-0 z-20 overflow-hidden bg-transparent whitespace-pre text-right select-none"
          style={{
            left: GUTTER_INSET,
            width: `${gutterWidthCh}ch`,
            paddingTop: "0.25rem",
            paddingBottom: "0.5rem",
          }}
        >
          <pre className="w-full text-right font-mono text-[9px] leading-5 tabular-nums text-[var(--editor-gutter-muted)]">
            {lineNumbersText}
          </pre>
        </div>
      )}
      <div
        ref={backdropRef}
        aria-hidden
        className={[
          "pointer-events-none absolute inset-y-0 left-0 right-0 overflow-hidden bg-transparent pb-2 pr-4 pt-1 outline-none select-none md:pr-5",
          wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          EDITOR_LINE_CLASS,
        ].join(" ")}
        style={{
          paddingLeft: `calc(${GUTTER_INSET} + ${gutterWidthCh}ch + ${GUTTER_TEXT_GAP})`,
        }}
      >
        {highlightedSegments}
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        readOnly={readOnly}
        wrap={wordWrap ? "soft" : "off"}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        onSelect={onSelect}
        onKeyUp={onSelect}
        onClick={onSelect}
        spellCheck={false}
        style={{
          paddingLeft: `calc(${GUTTER_INSET} + ${gutterWidthCh}ch + ${GUTTER_TEXT_GAP})`,
        }}
        className={[
          /* Absolute fill — only this pane scrolls; parent must not grow with line count. */
          "absolute inset-0 h-full w-full resize-none bg-transparent pb-2 pr-4 pt-1 text-on-surface outline-none md:pr-5",
          wordWrap
            ? "overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words"
            : "overflow-x-auto overflow-y-auto whitespace-pre",
          EDITOR_LINE_CLASS,
        ].join(" ")}
        aria-label={ariaLabel}
        data-filename={fileName}
      />
    </div>
  );
}

function ImagePreview({
  src,
  fileName,
  ariaLabel,
}: {
  src: string;
  fileName: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-container-high p-4">
      <img
        src={src}
        alt={ariaLabel}
        draggable={false}
        className="max-h-full max-w-full object-contain"
        data-filename={fileName}
      />
    </div>
  );
}

function ViewerDropZone({ fm, children }: { fm: FileManagerApi; children: ReactNode }) {
  const [dropActive, setDropActive] = useState(false);

  const handleDragOver = (event: DragEvent) => {
    allowFileManagerDrop(event, "copy");
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDropActive(false);
  };

  const handleDrop = (event: DragEvent) => {
    setDropActive(false);
    if (
      beginOsFileImport(
        event,
        osFileImportParentPath(fm.tree, fm.workspace),
        fm.importOsDrop,
        fm.showError,
        { openFirstViewable: true },
      )
    ) {
      fm.dispatch({ type: "set_drag", source: null, target: null });
    }
  };

  return (
    <div
      className={[
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        dropActive ? "ring-2 ring-inset ring-[var(--accent)]" : "",
      ].join(" ")}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

function ViewerNotice({
  kicker,
  body,
  children,
}: {
  kicker: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-container-high px-6 text-center">
      <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
        {kicker}
      </p>
      <p className="max-w-sm text-sm text-on-surface-variant">{body}</p>
      {children}
    </div>
  );
}

export function FileEditorPane({ fm, vaultName, active }: FileEditorPaneProps) {
  const { t } = useTranslation();
  const {
    workspace,
    dispatch,
    saveFile,
    getEditorContent,
    fileLoadError,
    isFileContentReady,
    writesLocked,
    isFileEditable,
    isFileViewable,
    isFileImage,
    isImportPending,
    isImportProcessing,
    importBudget,
  } = fm;
  // The tab bar marks a click at once; the file draws after that has painted.
  // A closed tab's file is left straight away, because its text may be gone.
  const paintedTabPath = useValueAfterPaint(workspace.activeTabPath);
  const activeTabPath =
    paintedTabPath && workspace.openTabs.includes(paintedTabPath)
      ? paintedTabPath
      : workspace.activeTabPath;
  const [markdownParser] = useState(createMarkdownParser);
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchHandleRef = useRef<FileEditorSearchHandle>(null);

  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [previewMatchesCount, setPreviewMatchesCount] = useState(0);
  const heading = useOutlineHeading(activeTabPath);
  const { follow: followHeading, release: releaseHeading } = heading;

  const searchQuery = fileSearchQuery(workspace, activeTabPath);
  const currentMarkdownView = fileMarkdownView(workspace, activeTabPath);
  const currentOutlineOpen = fileMarkdownOutlineOpen(workspace, activeTabPath);
  const currentWordWrap = fileEditorWordWrap(workspace, activeTabPath);

  const content = activeTabPath ? getEditorContent(activeTabPath) : "";
  // Matches and line numbers read this copy: a render with a new key commits
  // the textarea first and they catch up when React has time. Another tab's
  // text never stands in, so a tab switch draws the new file at once.
  const deferredContent = useDeferredValue(content);
  const deferredTabPath = useDeferredValue(activeTabPath);
  const shownContent = deferredTabPath === activeTabPath ? deferredContent : content;
  const isImage = activeTabPath ? isFileImage(activeTabPath) : false;
  const viewable = activeTabPath ? isFileViewable(activeTabPath) : false;
  const canSearch = viewable && !isImage;
  const codeMatches = useMemo(
    () => (canSearch && searchQuery ? findTextMatches(shownContent, searchQuery) : []),
    [canSearch, searchQuery, shownContent],
  );

  const markdownFile = activeTabPath
    ? vaultFileLanguageFromPath(activeTabPath) === "markdown"
    : false;
  const showPreview = markdownFile && currentMarkdownView === "preview";
  const showOutline = markdownFile && currentOutlineOpen;
  const showWordWrap = viewable && !isImage && !showPreview;

  const totalMatches = showPreview ? previewMatchesCount : codeMatches.length;

  const outlineSource = useSettledValue(content, MARKDOWN_OUTLINE_SETTLE_MS, activeTabPath);
  const outlineModel = useMemo(
    () => (markdownFile ? markdownParser.note(outlineSource).outline : null),
    [markdownFile, markdownParser, outlineSource],
  );

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [activeTabPath, searchQuery]);

  useEffect(() => {
    if (totalMatches > 0 && activeMatchIndex >= totalMatches) {
      setActiveMatchIndex(totalMatches - 1);
    }
  }, [totalMatches, activeMatchIndex]);

  const headingFrameRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(headingFrameRef.current), []);
  /** At most once per frame: each pass lays out a copy of the whole note. */
  const updateCodeActiveHeading = useCallback(() => {
    cancelAnimationFrame(headingFrameRef.current);
    headingFrameRef.current = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea || !outlineModel || outlineModel.entries.length === 0) return;
      const offsets = outlineModel.entries.map((entry) => entry.offset);
      followHeading(
        activeOutlineIndex(textareaLineTops(textarea, offsets, currentWordWrap), {
          offset: textarea.scrollTop,
          viewport: textarea.clientHeight,
          content: textarea.scrollHeight,
        }),
      );
    });
  }, [followHeading, outlineModel, currentWordWrap]);

  const handleCodeCaretChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !outlineModel || outlineModel.entries.length === 0) return;
    const pos = textarea.selectionStart;
    let active = 0;
    for (let i = 0; i < outlineModel.entries.length; i++) {
      if (outlineModel.entries[i].offset <= pos) active = i;
      else break;
    }
    followHeading(active);
  }, [followHeading, outlineModel]);

  const scrollToCurrentMatch = (nextIndex: number) => {
    if (showPreview) {
      previewRef.current?.scrollToMatch(nextIndex);
    } else if (textareaRef.current && codeMatches[nextIndex]) {
      const match = codeMatches[nextIndex];
      textareaRef.current.setSelectionRange(match.start, match.end);
      textareaRef.current.scrollTo?.({
        top: Math.max(0, textareaLineTop(textareaRef.current, match.start, currentWordWrap) - 40),
        behavior: "smooth",
      });
    }
  };

  const handleNextMatch = () => {
    if (totalMatches <= 0) return;
    const nextIndex = stepMatchIndex(activeMatchIndex, totalMatches, 1);
    setActiveMatchIndex(nextIndex);
    scrollToCurrentMatch(nextIndex);
  };

  const handlePrevMatch = () => {
    if (totalMatches <= 0) return;
    const prevIndex = stepMatchIndex(activeMatchIndex, totalMatches, -1);
    setActiveMatchIndex(prevIndex);
    scrollToCurrentMatch(prevIndex);
  };

  useEffect(() => {
    if (!active || !activeTabPath) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "z") {
        if (showWordWrap) {
          event.preventDefault();
          dispatch({
            type: "set_file_word_wrap",
            path: activeTabPath,
            wrap: !currentWordWrap,
          });
          return;
        }
      }
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (isFileEditable(activeTabPath)) void saveFile(activeTabPath);
      } else if (key === "f") {
        if (viewable && !isImage) {
          event.preventDefault();
          searchHandleRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    activeTabPath,
    isFileEditable,
    saveFile,
    viewable,
    isImage,
    dispatch,
    showWordWrap,
    currentWordWrap,
  ]);

  if (!activeTabPath) {
    return (
      <ViewerDropZone fm={fm}>
        <ViewerNotice
          kicker={t("modal.file_manager.viewer.empty_kicker")}
          body={t("modal.file_manager.viewer.empty_body")}
        />
      </ViewerDropZone>
    );
  }

  const fileName = fileBaseName(activeTabPath);
  const loadError = fileLoadError(activeTabPath);
  const importing = isImportPending(activeTabPath);
  const processing = isImportProcessing(activeTabPath);

  const fileNotice = (kicker: string, body: string, extra?: ReactNode) => (
    <ViewerDropZone fm={fm}>
      <EditorPathBar vaultName={vaultName} path={activeTabPath} />
      <ViewerNotice kicker={kicker} body={body}>
        {extra}
      </ViewerNotice>
    </ViewerDropZone>
  );

  if (importing) {
    return fileNotice(
      t(
        processing
          ? "modal.file_manager.import.loading_kicker"
          : "modal.file_manager.import.queued_kicker",
      ),
      processing
        ? t("modal.file_manager.import.loading_body")
        : t("modal.file_manager.import.queued_body", { name: fileName }),
      processing && importBudget.visible ? (
        <LoadingBudgetHint
          budgetMs={importBudget.budgetMs}
          remainingMs={importBudget.remainingMs}
        />
      ) : null,
    );
  }

  if (!isFileContentReady(activeTabPath)) {
    return fileNotice(
      t("modal.file_manager.viewer.loading_kicker"),
      t("modal.file_manager.viewer.loading_body", { name: fileName }),
    );
  }

  if (!viewable || (isImage && !loadError && !content)) {
    const presence = fm.folderPresence?.get(activeTabPath);
    const sendable = presence === "none";
    const openable = fm.osFolderAvailable && !sendable;
    return fileNotice(
      t("modal.file_manager.viewer.preview_unavailable_kicker"),
      t(
        sendable
          ? "modal.file_manager.viewer.preview_send_body"
          : openable
            ? "modal.file_manager.viewer.preview_open_body"
            : "modal.file_manager.viewer.preview_unavailable_body",
        { name: fileName },
      ),
      sendable ? (
        <Button variant="ghost" size="sm" onClick={() => void fm.sendToFolder(activeTabPath)}>
          {t("modal.file_manager.context.send_to_folder")}
        </Button>
      ) : openable ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void fm.openInSystemFileManager(activeTabPath)}
        >
          {t("modal.file_manager.context.open_system")}
        </Button>
      ) : null,
    );
  }

  if (loadError) {
    return fileNotice(t("modal.file_manager.viewer.read_failed_kicker"), loadError);
  }

  if (isImage) {
    return (
      <ViewerDropZone fm={fm}>
        <EditorPathBar vaultName={vaultName} path={activeTabPath} />
        <ImagePreview
          src={content}
          fileName={fileName}
          ariaLabel={t("modal.file_manager.viewer.image_label", { name: fileName })}
        />
      </ViewerDropZone>
    );
  }

  return (
    <ViewerDropZone fm={fm}>
      <EditorPathBar vaultName={vaultName} path={activeTabPath}>
        {canSearch ? (
          <FileEditorSearch
            ref={searchHandleRef}
            query={searchQuery}
            totalMatches={totalMatches}
            activeMatchIndex={activeMatchIndex}
            onQueryChange={(query) =>
              dispatch({ type: "set_file_search_query", path: activeTabPath, query })
            }
            onNextMatch={handleNextMatch}
            onPrevMatch={handlePrevMatch}
          />
        ) : null}
        {showWordWrap ? (
          <WordWrapToggle
            wrap={currentWordWrap}
            onChange={(wrap) => dispatch({ type: "set_file_word_wrap", path: activeTabPath, wrap })}
          />
        ) : null}
        {markdownFile ? (
          <>
            <MarkdownViewToggle
              mode={currentMarkdownView}
              onChange={(view) =>
                dispatch({ type: "set_file_markdown_view", path: activeTabPath, view })
              }
            />
            <MarkdownOutlineToggle
              open={currentOutlineOpen}
              onChange={(open) =>
                dispatch({ type: "set_file_markdown_outline_open", path: activeTabPath, open })
              }
            />
          </>
        ) : null}
      </EditorPathBar>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Scrolling the note by hand hands the outline mark back to the scroll. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          onWheel={releaseHeading}
          onPointerDown={releaseHeading}
          onTouchStart={releaseHeading}
          onKeyDown={releaseHeading}
        >
          {showPreview ? (
            <MarkdownPreview
              key={activeTabPath}
              ref={previewRef}
              markdown={content}
              parser={markdownParser}
              searchQuery={searchQuery}
              searchActiveIndex={activeMatchIndex}
              onMatchCountChange={setPreviewMatchesCount}
              onActiveHeadingChange={followHeading}
              onCopyFailed={() => fm.showToast(t("modal.file_manager.markdown.copy_failed"))}
              onChange={
                writesLocked
                  ? undefined
                  : (next) =>
                      dispatch({ type: "set_editor_draft", path: activeTabPath, content: next })
              }
            />
          ) : (
            <EditorWithLineNumbers
              key={activeTabPath}
              textareaRef={textareaRef}
              content={content}
              shownContent={shownContent}
              fileName={fileName}
              ariaLabel={t("modal.file_manager.viewer.editor_label", { name: fileName })}
              readOnly={writesLocked}
              matches={codeMatches}
              searchActiveIndex={activeMatchIndex}
              wordWrap={currentWordWrap}
              onScroll={updateCodeActiveHeading}
              onSelect={handleCodeCaretChange}
              onChange={(next) => {
                if (writesLocked) return;
                dispatch({ type: "set_editor_draft", path: activeTabPath, content: next });
              }}
            />
          )}
        </div>
        {showOutline && outlineModel ? (
          <MarkdownOutlinePanel
            outline={outlineModel}
            activeIndex={heading.index}
            onSelect={(index, entry) => {
              heading.pick(index);
              if (showPreview) previewRef.current?.scrollToHeading(index);
              else if (textareaRef.current)
                jumpTextareaTo(textareaRef.current, entry.offset, currentWordWrap);
            }}
          />
        ) : null}
      </div>
    </ViewerDropZone>
  );
}

export { hasUnsavedEditableTabs } from "../hooks/useVaultFileManager";
