import {
  memo,
  useCallback,
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
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  activeOutlineIndex,
  fileBaseName,
  fileEditorWordWrap,
  fileMarkdownOutlineOpen,
  fileMarkdownView,
  fileSearchQuery,
  findTextMatches,
  markdownOutline,
  stepMatchIndex,
  vaultFileLanguageFromPath,
  type TextMatch,
} from "@upriv/shared";
import { LoadingBudgetHint } from "@/components/ui";
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

interface EditorWithLineNumbersProps {
  content: string;
  fileName: string;
  ariaLabel: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** Search matches in `content`, highlighted behind the text. */
  matches: readonly TextMatch[];
  searchActiveIndex?: number;
  wordWrap?: boolean;
  onScroll?: () => void;
  onSelect?: () => void;
}

function EditorWithLineNumbers({
  content,
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

  const splitLines = useMemo(() => content.split("\n"), [content]);
  const lines = splitLines.length;
  const lineNumbersText = useMemo(
    () => Array.from({ length: lines }, (_, index) => String(index + 1)).join("\n"),
    [lines],
  );

  const syncScroll = () => {
    if (textareaRef.current) {
      if (gutterRef.current) {
        gutterRef.current.scrollTop = textareaRef.current.scrollTop;
      }
      if (backdropRef.current) {
        backdropRef.current.scrollTop = textareaRef.current.scrollTop;
        backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
      onScroll?.();
    }
  };

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
  });

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
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [textareaRef, wordWrap]);

  const gutterWidthCh = Math.max(2, String(lines).length);

  const highlightedSegments = useMemo(() => {
    if (matches.length === 0) return null;
    const segments: ReactNode[] = [];
    let lastIndex = 0;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (match.start > lastIndex) {
        segments.push(
          <span key={`text-${lastIndex}`} className="text-transparent">
            {content.slice(lastIndex, match.start)}
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
          {content.slice(match.start, match.end)}
        </mark>,
      );
      lastIndex = match.end;
    }
    if (lastIndex < content.length) {
      segments.push(
        <span key={`text-${lastIndex}`} className="text-transparent">
          {content.slice(lastIndex)}
        </span>,
      );
    }
    return segments;
  }, [content, matches, searchActiveIndex]);

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
          {splitLines.map((lineText, index) => (
            <WrappedGutterLine
              key={index}
              lineNumber={index + 1}
              lineText={lineText}
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
  const { showError } = useErrorToast();
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
        (error) => showError(error, "error.unexpected"),
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
  const activeTabPath = workspace.activeTabPath;
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchHandleRef = useRef<FileEditorSearchHandle>(null);

  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [previewMatchesCount, setPreviewMatchesCount] = useState(0);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);

  const searchQuery = fileSearchQuery(workspace, activeTabPath);
  const currentMarkdownView = fileMarkdownView(workspace, activeTabPath);
  const currentOutlineOpen = fileMarkdownOutlineOpen(workspace, activeTabPath);
  const currentWordWrap = fileEditorWordWrap(workspace, activeTabPath);

  const content = activeTabPath ? getEditorContent(activeTabPath) : "";
  const isImage = activeTabPath ? isFileImage(activeTabPath) : false;
  const viewable = activeTabPath ? isFileViewable(activeTabPath) : false;
  const canSearch = viewable && !isImage;
  const codeMatches = useMemo(
    () => (canSearch && searchQuery ? findTextMatches(content, searchQuery) : []),
    [canSearch, searchQuery, content],
  );

  const markdownFile = activeTabPath
    ? vaultFileLanguageFromPath(activeTabPath) === "markdown"
    : false;
  const showPreview = markdownFile && currentMarkdownView === "preview";
  const showOutline = markdownFile && currentOutlineOpen;
  const showWordWrap = viewable && !isImage && !showPreview;

  const totalMatches = showPreview ? previewMatchesCount : codeMatches.length;

  const outlineModel = useMemo(() => {
    if (!markdownFile) return null;
    return markdownOutline(content);
  }, [markdownFile, content]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [activeTabPath, searchQuery]);

  useEffect(() => {
    setActiveHeadingIndex(0);
  }, [activeTabPath]);

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
      setActiveHeadingIndex(
        activeOutlineIndex(textareaLineTops(textarea, offsets, currentWordWrap), {
          offset: textarea.scrollTop,
          viewport: textarea.clientHeight,
          content: textarea.scrollHeight,
        }),
      );
    });
  }, [outlineModel, currentWordWrap]);

  const handleCodeCaretChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !outlineModel || outlineModel.entries.length === 0) return;
    const pos = textarea.selectionStart;
    let active = 0;
    for (let i = 0; i < outlineModel.entries.length; i++) {
      if (outlineModel.entries[i].offset <= pos) active = i;
      else break;
    }
    setActiveHeadingIndex(active);
  }, [outlineModel]);

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
    return fileNotice(
      t("modal.file_manager.viewer.preview_unavailable_kicker"),
      t("modal.file_manager.viewer.preview_unavailable_body", { name: fileName }),
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {showPreview ? (
            <MarkdownPreview
              key={activeTabPath}
              ref={previewRef}
              markdown={content}
              searchQuery={searchQuery}
              searchActiveIndex={activeMatchIndex}
              onMatchCountChange={setPreviewMatchesCount}
              onActiveHeadingChange={setActiveHeadingIndex}
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
            activeIndex={activeHeadingIndex}
            onSelect={(index, entry) => {
              setActiveHeadingIndex(index);
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
