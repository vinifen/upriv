import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import {
  createMarkdownParser,
  fileBaseName,
  fileEditorWordWrap,
  fileMarkdownOutlineOpen,
  fileMarkdownOutlineWidth,
  fileMarkdownView,
  fileSearchQuery,
  findTextMatches,
  MARKDOWN_OUTLINE_SETTLE_MS,
  stepMatchIndex,
  vaultFileLanguageFromPath,
} from "@upriv/shared";
import {
  useOutlineHeading,
  useOutlineWidthDrag,
  useSettledValue,
  useValueAfterPaint,
} from "@upriv/shared/react";
import { Button, ElapsedTime } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { ExplorerActions } from "../tree/ExplorerActions";
import { PaneResizeHandle } from "../workspace/PaneResizeHandle";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { EditorPathBar } from "./EditorPathBar";
import { FileEditorSearch, type FileEditorSearchHandle } from "./FileEditorSearch";
import { MarkdownOutlinePanel, MarkdownOutlineToggle, OUTLINE_MAX_WIDTH } from "./MarkdownOutline";
import { MarkdownPreview, type MarkdownPreviewHandle } from "./MarkdownPreview";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import { WordWrapToggle } from "./WordWrapToggle";

interface FileEditorPaneProps {
  fm: FileManagerApi;
  /** Vault display name — first crumb of the path row. */
  vaultName: string;
  /** Lets a touch anywhere in the file manager leave the search field. */
  searchRef: RefObject<FileEditorSearchHandle>;
}

function ImagePreview({ src, ariaLabel }: { src: string; ariaLabel: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.imageWrap, { backgroundColor: colors.surfaceContainerHigh }]}>
      <Image
        source={{ uri: src }}
        accessibilityLabel={ariaLabel}
        resizeMode="contain"
        style={styles.image}
      />
    </View>
  );
}

function EmptyState({
  kicker,
  body,
  children,
}: {
  kicker: string;
  body: string;
  children?: ReactNode;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.empty, { backgroundColor: colors.surfaceContainerHigh }]}>
      <Text style={[typography.caption, styles.kicker, { color: colors.onSurfaceVariant }]}>
        {kicker}
      </Text>
      <Text style={[typography.body, styles.body, { color: colors.onSurfaceVariant }]}>{body}</Text>
      {children}
    </View>
  );
}

export function FileEditorPane({ fm, vaultName, searchRef }: FileEditorPaneProps) {
  const { t } = useTranslation();
  const {
    workspace,
    dispatch,
    getEditorContent,
    fileLoadError,
    isFileContentReady,
    isFileViewable,
    isFileImage,
    isImportPending,
    isImportProcessing,
    editorImportStartedAt,
    stopImports,
  } = fm;
  // The tab bar marks a tap at once; the file draws after that has painted.
  // A closed tab's file is left straight away, because its text may be gone.
  const paintedTabPath = useValueAfterPaint(workspace.activeTabPath);
  const activeTabPath =
    paintedTabPath && workspace.openTabs.includes(paintedTabPath)
      ? paintedTabPath
      : workspace.activeTabPath;
  const [markdownParser] = useState(createMarkdownParser);
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [previewMatchCount, setPreviewMatchCount] = useState(0);
  const heading = useOutlineHeading(activeTabPath);
  const outlineRef = useRef<View>(null);
  /** Widths from the last layout: a drag reads them as it starts. */
  const outlineWidthRef = useRef(0);
  const editorRowWidthRef = useRef(0);
  // Moves size the outline through native props: a re-render per move is too slow.
  const outlineDrag = useOutlineWidthDrag({
    savedWidth: fileMarkdownOutlineWidth(workspace, activeTabPath),
    measure: () => ({ outline: outlineWidthRef.current, row: editorRowWidthRef.current }),
    onDragFrame: (width) => {
      outlineRef.current?.setNativeProps({
        style:
          width === null
            ? { width: 0, opacity: 0 }
            : { width, maxWidth: OUTLINE_MAX_WIDTH, opacity: 1 },
      });
    },
    onCommit: (width) => {
      if (activeTabPath) {
        dispatch({ type: "set_file_markdown_outline_width", path: activeTabPath, width });
      }
    },
    onCollapse: () => {
      if (activeTabPath) {
        dispatch({ type: "set_file_markdown_outline_open", path: activeTabPath, open: false });
      }
    },
  });

  const content = activeTabPath ? getEditorContent(activeTabPath) : "";
  // Matches and line numbers read this copy: a key reaches the input first and
  // they catch up when React has time. Another tab's text never stands in.
  const deferredContent = useDeferredValue(content);
  const deferredTabPath = useDeferredValue(activeTabPath);
  const shownContent = deferredTabPath === activeTabPath ? deferredContent : content;
  const searchQuery = fileSearchQuery(workspace, activeTabPath);
  const isImage = activeTabPath ? isFileImage(activeTabPath) : false;
  const viewable = activeTabPath ? isFileViewable(activeTabPath) : false;
  const canSearch = viewable && !isImage;
  const markdownFile = activeTabPath
    ? vaultFileLanguageFromPath(activeTabPath) === "markdown"
    : false;
  const showPreview = markdownFile && fileMarkdownView(workspace, activeTabPath) === "preview";
  const codeMatches = useMemo(
    () => (canSearch && searchQuery ? findTextMatches(shownContent, searchQuery) : []),
    [canSearch, searchQuery, shownContent],
  );
  const totalMatches = showPreview ? previewMatchCount : codeMatches.length;
  const outlineSource = useSettledValue(content, MARKDOWN_OUTLINE_SETTLE_MS, activeTabPath);
  const outlineModel = useMemo(
    () => (markdownFile ? markdownParser.note(outlineSource).outline : null),
    [markdownFile, markdownParser, outlineSource],
  );
  const headingOffsets = useMemo(
    () => outlineModel?.entries.map((entry) => entry.offset) ?? [],
    [outlineModel],
  );

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [activeTabPath, searchQuery]);

  useEffect(() => {
    if (totalMatches > 0 && activeMatchIndex >= totalMatches) setActiveMatchIndex(totalMatches - 1);
  }, [activeMatchIndex, totalMatches]);

  if (!activeTabPath) {
    return (
      <EmptyState
        kicker={t("modal.file_manager.viewer.empty_kicker")}
        body={t("modal.file_manager.viewer.empty_body_touch")}
      >
        {/* The explorer's own buttons, within reach while no file is open. */}
        <View style={styles.emptyActions}>
          <ExplorerActions fm={fm} variant="labeled" />
          <Button
            label={t("modal.file_manager.viewer.empty_search")}
            icon="search"
            variant="ghost"
            size="sm"
            onPress={() => fm.explorerSearch.show(true)}
          />
        </View>
      </EmptyState>
    );
  }

  const fileName = fileBaseName(activeTabPath);
  const loadError = fileLoadError(activeTabPath);
  const importing = isImportPending(activeTabPath);
  const processing = isImportProcessing(activeTabPath);

  const fileNotice = (kicker: string, body: string, extra?: ReactNode) => (
    <View style={styles.editorColumn}>
      <EditorPathBar vaultName={vaultName} path={activeTabPath} />
      <EmptyState kicker={kicker} body={body}>
        {extra}
      </EmptyState>
    </View>
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
      <View style={styles.importNotice}>
        {processing ? <ElapsedTime startedAt={editorImportStartedAt} /> : null}
        <Button label={t("action.stop")} variant="ghost" size="sm" onPress={stopImports} />
      </View>,
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
        <Button
          label={t("modal.file_manager.context.send_to_folder")}
          variant="ghost"
          size="sm"
          onPress={() => void fm.sendToFolder(activeTabPath)}
        />
      ) : openable ? (
        <Button
          label={t("modal.file_manager.context.open_system")}
          variant="ghost"
          size="sm"
          onPress={() => void fm.openInSystemFileManager(activeTabPath)}
        />
      ) : null,
    );
  }

  if (loadError) {
    return fileNotice(t("modal.file_manager.viewer.read_failed_kicker"), loadError);
  }

  if (isImage) {
    return (
      <View style={styles.editorColumn}>
        <EditorPathBar vaultName={vaultName} path={activeTabPath} />
        <ImagePreview
          src={content}
          ariaLabel={t("modal.file_manager.viewer.image_label", { name: fileName })}
        />
      </View>
    );
  }

  const currentMarkdownView = fileMarkdownView(workspace, activeTabPath);
  const currentOutlineOpen = fileMarkdownOutlineOpen(workspace, activeTabPath);
  const currentWordWrap = fileEditorWordWrap(workspace, activeTabPath);
  const showOutline = markdownFile && currentOutlineOpen && outlineModel !== null;

  const scrollToMatch = (index: number) => {
    if (showPreview) previewRef.current?.scrollToMatch(index);
    else if (codeMatches[index]) editorRef.current?.revealOffset(codeMatches[index].start);
  };
  const stepMatch = (step: 1 | -1) => {
    if (totalMatches <= 0) return;
    const next = stepMatchIndex(activeMatchIndex, totalMatches, step);
    setActiveMatchIndex(next);
    scrollToMatch(next);
  };

  return (
    <View style={styles.editorColumn}>
      <EditorPathBar vaultName={vaultName} path={activeTabPath}>
        {canSearch ? (
          <FileEditorSearch
            ref={searchRef}
            query={searchQuery}
            totalMatches={totalMatches}
            activeMatchIndex={activeMatchIndex}
            onQueryChange={(query) =>
              dispatch({ type: "set_file_search_query", path: activeTabPath, query })
            }
            onNextMatch={() => stepMatch(1)}
            onPrevMatch={() => stepMatch(-1)}
          />
        ) : null}
        {showPreview ? null : (
          <WordWrapToggle
            wrap={currentWordWrap}
            onChange={(wrap) => dispatch({ type: "set_file_word_wrap", path: activeTabPath, wrap })}
          />
        )}
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
      <View
        style={styles.editorRow}
        onLayout={(event) => {
          editorRowWidthRef.current = event.nativeEvent.layout.width;
        }}
      >
        <View style={styles.editorColumn}>
          {showPreview ? (
            <MarkdownPreview
              key={activeTabPath}
              ref={previewRef}
              markdown={content}
              parser={markdownParser}
              searchQuery={searchQuery}
              searchActiveIndex={activeMatchIndex}
              besideOutline={showOutline}
              onMatchCountChange={setPreviewMatchCount}
              onActiveHeadingChange={heading.follow}
              onUserScroll={heading.release}
              onCopyFailed={() => fm.showToast(t("modal.file_manager.markdown.copy_failed"))}
              onChange={(next) =>
                dispatch({ type: "set_editor_draft", path: activeTabPath, content: next })
              }
            />
          ) : (
            <CodeEditor
              key={activeTabPath}
              ref={editorRef}
              content={content}
              shownContent={shownContent}
              ariaLabel={t("modal.file_manager.viewer.editor_label", { name: fileName })}
              wordWrap={currentWordWrap}
              besideOutline={showOutline}
              matches={codeMatches}
              activeMatchIndex={activeMatchIndex}
              headingOffsets={headingOffsets}
              onActiveHeading={heading.follow}
              onUserScroll={heading.release}
              onChange={(next) =>
                dispatch({ type: "set_editor_draft", path: activeTabPath, content: next })
              }
            />
          )}
        </View>
        {showOutline ? (
          <>
            {/* Drag toward the right edge to close the outline; this note keeps its width. */}
            <PaneResizeHandle
              axis="x"
              overlay
              label={t("modal.file_manager.markdown.outline_resize")}
              onDragStart={outlineDrag.onDragStart}
              onDrag={outlineDrag.onDrag}
              onDragEnd={outlineDrag.onDragEnd}
            />
            <MarkdownOutlinePanel
              panelRef={outlineRef}
              width={outlineDrag.width}
              onWidth={(width) => {
                outlineWidthRef.current = width;
              }}
              outline={outlineModel}
              activeIndex={heading.index}
              onSelect={(index, entry) => {
                heading.pick(index);
                if (showPreview) previewRef.current?.scrollToHeading(index);
                else editorRef.current?.revealOffset(entry.offset);
              }}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editorColumn: { flex: 1, minHeight: 0, minWidth: 0 },
  importNotice: { alignItems: "center", gap: spacing.sm },
  emptyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    maxWidth: 420,
  },
  editorRow: { flex: 1, minHeight: 0, flexDirection: "row" },
  empty: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  kicker: {
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "600",
    textAlign: "center",
  },
  body: { textAlign: "center", maxWidth: 360 },
  imageWrap: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  image: { width: "100%", height: "100%" },
});
