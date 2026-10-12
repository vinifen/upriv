import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import { fileBaseName, vaultFileLanguageFromPath } from "@upriv/shared";
import { LoadingBudgetHint } from "@/components/ui";
import { allowFileManagerDrop, beginOsFileImport } from "../lib/osFileDrop";
import { osFileImportParentPath } from "../lib/osFileImportTarget";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { EditorPathBar } from "./EditorPathBar";
import { MarkdownOutlinePanel, MarkdownOutlineToggle } from "./MarkdownOutline";
import { MarkdownPreview, type MarkdownPreviewHandle } from "./MarkdownPreview";
import { MarkdownViewToggle } from "./MarkdownViewToggle";

interface FileEditorPaneProps {
  fm: FileManagerApi;
  /** Vault display name — first crumb of the path row. */
  vaultName: string;
}

const EDITOR_LINE_CLASS = "font-mono text-[13px] leading-5";
const GUTTER_INSET = "0.1rem";
const GUTTER_TEXT_GAP = "0.2rem";

function lineCount(content: string): number {
  if (!content) return 1;
  return content.split("\n").length;
}

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

/** Top of the line holding `offset`. The textarea soft-wraps, so measure a hidden copy. */
function textareaLineTop(textarea: HTMLTextAreaElement, offset: number): number {
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
  mirror.textContent = textarea.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop - (parseFloat(style.paddingTop) || 0);
  mirror.remove();
  return top;
}

function jumpTextareaTo(textarea: HTMLTextAreaElement, offset: number) {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(offset, offset);
  textarea.scrollTo({ top: Math.max(0, textareaLineTop(textarea, offset)), behavior: "smooth" });
}

interface EditorWithLineNumbersProps {
  content: string;
  fileName: string;
  ariaLabel: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

function EditorWithLineNumbers({
  content,
  fileName,
  ariaLabel,
  readOnly = false,
  onChange,
  textareaRef,
}: EditorWithLineNumbersProps) {
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => lineCount(content), [content]);
  const lineNumbersText = useMemo(
    () => Array.from({ length: lines }, (_, index) => String(index + 1)).join("\n"),
    [lines],
  );

  const syncScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const gutterWidthCh = Math.max(2, String(lines).length);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-container-high">
      <div
        ref={gutterRef}
        aria-hidden
        className="pointer-events-none absolute bottom-0 top-0 overflow-hidden whitespace-pre text-center select-none"
        style={{
          left: GUTTER_INSET,
          width: `${gutterWidthCh}ch`,
          paddingTop: "0.25rem",
          paddingBottom: "0.5rem",
        }}
      >
        <pre className="w-full text-center font-mono text-[9px] leading-5 tabular-nums text-[var(--editor-gutter-muted)]">
          {lineNumbersText}
        </pre>
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        style={{
          paddingLeft: `calc(${GUTTER_INSET} + ${gutterWidthCh}ch + ${GUTTER_TEXT_GAP})`,
        }}
        className={[
          /* Absolute fill — only this pane scrolls; parent must not grow with line count. */
          "absolute inset-0 h-full w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent pb-2 pr-4 pt-1 text-on-surface outline-none md:pr-5",
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

export function FileEditorPane({ fm, vaultName }: FileEditorPaneProps) {
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

  useEffect(() => {
    if (!activeTabPath) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (isFileEditable(activeTabPath)) void saveFile(activeTabPath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabPath, isFileEditable, saveFile]);

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

  const isImage = isFileImage(activeTabPath);
  const viewable = isFileViewable(activeTabPath);
  const content = getEditorContent(activeTabPath);
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

  const markdownFile = vaultFileLanguageFromPath(activeTabPath) === "markdown";
  const showPreview = markdownFile && workspace.markdownView === "preview";
  const showOutline = markdownFile && workspace.markdownOutlineOpen;

  return (
    <ViewerDropZone fm={fm}>
      <EditorPathBar vaultName={vaultName} path={activeTabPath}>
        {markdownFile ? (
          <>
            <MarkdownViewToggle
              mode={workspace.markdownView}
              onChange={(view) => dispatch({ type: "set_markdown_view", view })}
            />
            <MarkdownOutlineToggle
              open={workspace.markdownOutlineOpen}
              onChange={(open) => dispatch({ type: "set_markdown_outline_open", open })}
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
              onChange={(next) => {
                if (writesLocked) return;
                dispatch({ type: "set_editor_draft", path: activeTabPath, content: next });
              }}
            />
          )}
        </div>
        {showOutline ? (
          <MarkdownOutlinePanel
            markdown={content}
            onSelect={(index, entry) => {
              if (showPreview) previewRef.current?.scrollToHeading(index);
              else if (textareaRef.current) jumpTextareaTo(textareaRef.current, entry.offset);
            }}
          />
        ) : null}
      </div>
    </ViewerDropZone>
  );
}

export { hasUnsavedEditableTabs } from "../hooks/useVaultFileManager";
