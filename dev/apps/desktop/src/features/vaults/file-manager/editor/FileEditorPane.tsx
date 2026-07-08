import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { fileBaseName } from "@upriv/shared";
import { filesFromDataTransfer, isOsFileDrag } from "../lib/osFileDrop";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileEditorPaneProps {
  fm: FileManagerApi;
}

const EDITOR_LINE_CLASS = "font-mono text-sm leading-[1.625rem]";
const GUTTER_INSET = "0.5rem";
const GUTTER_TEXT_GAP = "0.25rem";

function lineCount(content: string): number {
  if (!content) return 1;
  return content.split("\n").length;
}

interface EditorWithLineNumbersProps {
  content: string;
  fileName: string;
  ariaLabel: string;
  onChange: (content: string) => void;
}

function EditorWithLineNumbers({
  content,
  fileName,
  ariaLabel,
  onChange,
}: EditorWithLineNumbersProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => lineCount(content), [content]);

  const syncScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const gutterWidthCh = Math.max(2, String(lines).length);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-container-high py-3">
      <div
        ref={gutterRef}
        aria-hidden
        className="modal-scroll-pane pointer-events-none absolute bottom-3 top-3 overflow-hidden select-none"
        style={{ left: GUTTER_INSET, width: `${gutterWidthCh}ch` }}
      >
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index + 1}
            className="flex h-[1.625rem] items-center justify-end font-mono text-[9px] tabular-nums text-[var(--vault-status-sealed)]"
          >
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        style={{
          paddingLeft: `calc(${GUTTER_INSET} + ${gutterWidthCh}ch + ${GUTTER_TEXT_GAP})`,
        }}
        className={[
          "modal-scroll-pane h-full min-h-0 w-full resize-none bg-transparent pr-4 text-on-surface outline-none md:pr-5",
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
    <div className="modal-scroll-pane flex min-h-0 flex-1 items-center justify-center bg-surface-container-high p-4">
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
    if (!isOsFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDropActive(false);
  };

  const handleDrop = (event: DragEvent) => {
    if (!isOsFileDrag(event)) return;
    event.preventDefault();
    setDropActive(false);
    void (async () => {
      const files = await filesFromDataTransfer(event);
      await fm.importFiles("/", files, { openFirstViewable: true });
    })();
  };

  return (
    <div
      className={[
        "flex min-h-0 flex-1 flex-col",
        dropActive ? "ring-2 ring-inset ring-[var(--accent)]" : "",
      ].join(" ")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

export function FileEditorPane({ fm }: FileEditorPaneProps) {
  const { t } = useTranslation();
  const {
    workspace,
    dispatch,
    saveFile,
    getEditorContent,
    isFileEditable,
    isFileViewable,
    isFileImage,
  } = fm;
  const activeTabPath = workspace.activeTabPath;

  useEffect(() => {
    if (!activeTabPath) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (isFileEditable(activeTabPath)) saveFile(activeTabPath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabPath, isFileEditable, saveFile]);

  if (!activeTabPath) {
    return (
      <ViewerDropZone fm={fm}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-container-high px-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            {t("modal.file_manager.viewer.empty_kicker")}
          </p>
          <p className="max-w-sm text-sm text-on-surface-variant">
            {t("modal.file_manager.viewer.empty_body")}
          </p>
        </div>
      </ViewerDropZone>
    );
  }

  const isImage = isFileImage(activeTabPath);
  const viewable = isFileViewable(activeTabPath);
  const content = getEditorContent(activeTabPath);
  const fileName = fileBaseName(activeTabPath);

  if (isImage && content) {
    return (
      <ViewerDropZone fm={fm}>
        <ImagePreview
          src={content}
          fileName={fileName}
          ariaLabel={t("modal.file_manager.viewer.image_label", { name: fileName })}
        />
      </ViewerDropZone>
    );
  }

  if (!viewable) {
    return (
      <ViewerDropZone fm={fm}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-container-high px-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            {t("modal.file_manager.viewer.preview_unavailable_kicker")}
          </p>
          <p className="max-w-sm text-sm text-on-surface-variant">
            {t("modal.file_manager.viewer.preview_unavailable_body", { name: fileName })}
          </p>
        </div>
      </ViewerDropZone>
    );
  }

  return (
    <ViewerDropZone fm={fm}>
      <EditorWithLineNumbers
        content={content}
        fileName={fileName}
        ariaLabel={t("modal.file_manager.viewer.editor_label", { name: fileName })}
        onChange={(next) =>
          dispatch({ type: "set_editor_draft", path: activeTabPath, content: next })
        }
      />
    </ViewerDropZone>
  );
}

/** Whether any open tab has unsaved editable changes (tab bar Save all). */
export function hasUnsavedEditableTabs(fm: FileManagerApi): boolean {
  return fm.workspace.dirtyPaths.some((path: string) => fm.isFileEditable(path));
}
