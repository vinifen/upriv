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
  fileMarkdownView,
  fileSearchQuery,
  findTextMatches,
  MARKDOWN_OUTLINE_SETTLE_MS,
  stepMatchIndex,
  vaultFileLanguageFromPath,
} from "@upriv/shared";
import { useOutlineHeading, useSettledValue, useValueAfterPaint } from "@upriv/shared/react";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
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
    writesLocked,
    isFileViewable,
    isFileImage,
    isImportPending,
    isImportProcessing,
    importBudget,
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
      />
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
      <View style={styles.editorRow}>
        <View style={styles.editorColumn}>
          {showPreview ? (
            <MarkdownPreview
              key={activeTabPath}
              ref={previewRef}
              markdown={content}
              parser={markdownParser}
              searchQuery={searchQuery}
              searchActiveIndex={activeMatchIndex}
              onMatchCountChange={setPreviewMatchCount}
              onActiveHeadingChange={heading.follow}
              onUserScroll={heading.release}
              onCopyFailed={() => fm.showToast(t("modal.file_manager.markdown.copy_failed"))}
              onChange={
                writesLocked
                  ? undefined
                  : (next) =>
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
              readOnly={writesLocked}
              wordWrap={currentWordWrap}
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
          <MarkdownOutlinePanel
            outline={outlineModel}
            activeIndex={heading.index}
            onSelect={(index, entry) => {
              heading.pick(index);
              if (showPreview) previewRef.current?.scrollToHeading(index);
              else editorRef.current?.revealOffset(entry.offset);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editorColumn: { flex: 1, minHeight: 0, minWidth: 0 },
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
