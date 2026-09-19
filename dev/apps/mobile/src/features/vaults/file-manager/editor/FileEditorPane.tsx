import { useMemo, useRef } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputScrollEventData,
} from "react-native";
import { fileBaseName } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileEditorPaneProps {
  fm: FileManagerApi;
}

const EDITOR_FONT_SIZE = 13;
const EDITOR_LINE_HEIGHT = 20;
const GUTTER_FONT_SIZE = 9;
const GUTTER_INSET = 3;
const GUTTER_TEXT_GAP = 3;
const GUTTER_DIGIT_WIDTH = 7;

function lineCount(content: string): number {
  if (!content) return 1;
  return content.split("\n").length;
}

function EditorWithLineNumbers({
  content,
  ariaLabel,
  onChange,
}: {
  content: string;
  ariaLabel: string;
  onChange: (content: string) => void;
}) {
  const { colors } = useTheme();
  const gutterRef = useRef<ScrollView>(null);

  const lines = useMemo(() => lineCount(content), [content]);
  const lineNumbersText = useMemo(
    () => Array.from({ length: lines }, (_, index) => String(index + 1)).join("\n"),
    [lines],
  );
  const gutterWidth = Math.max(2, String(lines).length) * GUTTER_DIGIT_WIDTH;

  const syncGutter = (event: NativeSyntheticEvent<TextInputScrollEventData>) => {
    gutterRef.current?.scrollTo({
      y: event.nativeEvent.contentOffset.y,
      animated: false,
    });
  };

  return (
    <View style={[styles.editorRoot, { backgroundColor: colors.surfaceContainerHigh }]}>
      <ScrollView
        ref={gutterRef}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        style={[styles.gutter, { left: GUTTER_INSET, width: gutterWidth }]}
        contentContainerStyle={styles.gutterContent}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          allowFontScaling={false}
          style={[styles.gutterText, { color: colors.editorGutterMuted }]}
        >
          {lineNumbersText}
        </Text>
      </ScrollView>
      <TextInput
        collapsable={false}
        value={content}
        onChangeText={onChange}
        onScroll={syncGutter}
        multiline
        scrollEnabled
        blurOnSubmit={false}
        importantForAutofill="no"
        spellCheck={false}
        autoCorrect={false}
        autoCapitalize="none"
        textAlignVertical="top"
        underlineColorAndroid="transparent"
        allowFontScaling={false}
        accessibilityLabel={ariaLabel}
        style={[
          styles.editor,
          {
            paddingLeft: GUTTER_INSET + gutterWidth + GUTTER_TEXT_GAP,
            color: colors.onSurface,
          },
        ]}
      />
    </View>
  );
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

function EmptyState({ kicker, body }: { kicker: string; body: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.empty, { backgroundColor: colors.surfaceContainerHigh }]}>
      <Text style={[typography.caption, styles.kicker, { color: colors.onSurfaceVariant }]}>
        {kicker}
      </Text>
      <Text style={[typography.body, styles.body, { color: colors.onSurfaceVariant }]}>{body}</Text>
    </View>
  );
}

export function FileEditorPane({ fm }: FileEditorPaneProps) {
  const { t } = useTranslation();
  const { workspace, dispatch, getEditorContent, isFileViewable, isFileImage } = fm;
  const activeTabPath = workspace.activeTabPath;

  if (!activeTabPath) {
    return (
      <EmptyState
        kicker={t("modal.file_manager.viewer.empty_kicker")}
        body={t("modal.file_manager.viewer.empty_body_touch")}
      />
    );
  }

  const fileName = fileBaseName(activeTabPath);
  const content = getEditorContent(activeTabPath);
  const isImage = isFileImage(activeTabPath);
  const viewable = isFileViewable(activeTabPath);

  if (isImage) {
    if (!content) {
      return (
        <EmptyState
          kicker={t("modal.file_manager.viewer.preview_unavailable_kicker")}
          body={t("modal.file_manager.viewer.preview_unavailable_body", { name: fileName })}
        />
      );
    }
    return (
      <ImagePreview
        src={content}
        ariaLabel={t("modal.file_manager.viewer.image_label", { name: fileName })}
      />
    );
  }

  if (!viewable) {
    return (
      <EmptyState
        kicker={t("modal.file_manager.viewer.preview_unavailable_kicker")}
        body={t("modal.file_manager.viewer.preview_unavailable_body", { name: fileName })}
      />
    );
  }

  return (
    <EditorWithLineNumbers
      key={activeTabPath}
      content={content}
      ariaLabel={t("modal.file_manager.viewer.editor_label", { name: fileName })}
      onChange={(next) =>
        dispatch({ type: "set_editor_draft", path: activeTabPath, content: next })
      }
    />
  );
}

const styles = StyleSheet.create({
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
  editorRoot: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
  },
  gutter: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 1,
  },
  gutterContent: {
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "center",
  },
  gutterText: {
    fontFamily: "monospace",
    fontSize: GUTTER_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    textAlign: "center",
    width: "100%",
    includeFontPadding: false,
  },
  /* Absolute fill — TextInput must not grow with line count (nested scroll). */
  editor: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: 8,
    paddingBottom: 8,
    paddingRight: 12,
    fontFamily: "monospace",
    fontSize: EDITOR_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    backgroundColor: "transparent",
    textAlignVertical: "top",
  },
});
