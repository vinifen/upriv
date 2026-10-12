import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
} from "react";
import { Clipboard, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  MARKDOWN_COPY_DOUBLE_TAP_MS,
  markdownLinkHref,
  parseMarkdownDocument,
  toggleMarkdownTask,
  type MarkdownAlign,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownListItem,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme, type ThemeColors } from "@/theme";

const COPIED_MS = 1600;

interface MarkdownPreviewProps {
  markdown: string;
  onCopyFailed: () => void;
  /** Task checkbox edits. Omit for a read-only note (checkboxes stay disabled). */
  onChange?: (markdown: string) => void;
}

interface PreviewActions {
  colors: ThemeColors;
  copiedKey: string | null;
  copy: (key: string, text: string) => void;
  /** Copies on the second tap of the same value within `MARKDOWN_COPY_DOUBLE_TAP_MS`. */
  copyOnDoubleTap: (key: string, text: string) => void;
  copyLabel: string;
  copiedLabel: string;
  onFootnote: (id: string) => void;
  toggleTask: ((offset: number, checked: boolean) => void) | null;
}

export interface MarkdownPreviewHandle {
  /** Index into `markdownOutline` — the n-th top-level heading. */
  scrollToHeading: (index: number) => void;
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(
  function MarkdownPreview(props, ref) {
    return <MarkdownPreviewBody {...props} handleRef={ref} />;
  },
);

function MarkdownPreviewBody({
  markdown,
  onCopyFailed,
  onChange,
  handleRef,
}: MarkdownPreviewProps & { handleRef: ForwardedRef<MarkdownPreviewHandle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const model = useMemo(() => parseMarkdownDocument(markdown), [markdown]);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef(0);
  const noteY = useRef(new Map<string, number>());
  /** Top-level block index → y in the scroll content. */
  const headingY = useRef(new Map<number, number>());

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToHeading: (index) => {
        if (model.status !== "ok") return;
        let seen = -1;
        const blockIndex = model.blocks.findIndex(
          (block) => block.type === "heading" && ++seen === index,
        );
        const y = headingY.current.get(blockIndex);
        if (y === undefined) return;
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
      },
    }),
    [model],
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ key: string; at: number } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    setCopiedKey(null);
  }, [markdown]);

  const copy = (key: string, text: string) => {
    try {
      Clipboard.setString(text);
    } catch {
      onCopyFailed();
      return;
    }
    setCopiedKey(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, COPIED_MS);
  };

  const copyOnDoubleTap = (key: string, text: string) => {
    const now = Date.now();
    const previous = lastTap.current;
    if (previous && previous.key === key && now - previous.at < MARKDOWN_COPY_DOUBLE_TAP_MS) {
      lastTap.current = null;
      copy(key, text);
      return;
    }
    lastTap.current = { key, at: now };
  };

  const actions: PreviewActions = {
    colors,
    copiedKey,
    copy,
    copyOnDoubleTap,
    copyLabel: t("modal.file_manager.markdown.copy"),
    copiedLabel: t("modal.file_manager.markdown.copied"),
    onFootnote: (id) => {
      const y = sectionY.current + (noteY.current.get(id) ?? 0);
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
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
      <View style={[styles.fill, styles.center, { backgroundColor: colors.surfaceContainerHigh }]}>
        <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>
          {t("modal.file_manager.markdown.too_large")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.fill, { backgroundColor: colors.surfaceContainerHigh }]}
      contentContainerStyle={styles.content}
    >
      <Blocks
        blocks={model.blocks}
        actions={actions}
        path="doc"
        onHeadingLayout={(index, y) => headingY.current.set(index, y)}
      />
      {model.footnotes.length > 0 ? (
        <View
          onLayout={(event) => {
            sectionY.current = event.nativeEvent.layout.y;
          }}
          style={[styles.footnotes, { borderTopColor: colors.outlineVariant }]}
        >
          <Text style={[styles.noteTitle, { color: colors.onSurface }]}>
            {t("modal.file_manager.markdown.footnotes")}
          </Text>
          {model.footnotes.map((note) => (
            <View
              key={note.id}
              onLayout={(event) => {
                noteY.current.set(note.id, event.nativeEvent.layout.y);
              }}
              style={styles.note}
            >
              <Text style={[styles.noteLabel, { color: colors.accent }]}>{note.label}.</Text>
              <View style={styles.noteBody}>
                <Blocks blocks={note.children} actions={actions} path={note.id} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** `onHeadingLayout`: top level only — those headings are the outline entries. */
function Blocks({
  blocks,
  actions,
  path,
  onHeadingLayout,
}: {
  blocks: MarkdownBlock[];
  actions: PreviewActions;
  path: string;
  onHeadingLayout?: (blockIndex: number, y: number) => void;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block
          key={`${block.type}-${index}`}
          block={block}
          actions={actions}
          path={`${path}-${index}`}
          first={index === 0}
          onHeadingLayout={onHeadingLayout ? (y) => onHeadingLayout(index, y) : undefined}
        />
      ))}
    </>
  );
}

function Block({
  block,
  actions,
  path,
  first,
  onHeadingLayout,
}: {
  block: MarkdownBlock;
  actions: PreviewActions;
  path: string;
  first: boolean;
  onHeadingLayout?: (y: number) => void;
}) {
  const { colors } = actions;
  switch (block.type) {
    case "paragraph":
      return (
        <Text style={[styles.paragraph, { color: colors.onSurface }]}>
          <Inlines nodes={block.children} actions={actions} keyPrefix={path} />
        </Text>
      );
    case "heading":
      return (
        <Text
          onLayout={
            onHeadingLayout ? (event) => onHeadingLayout(event.nativeEvent.layout.y) : undefined
          }
          style={[
            headingStyle(block.depth),
            { color: colors.onSurface },
            first ? styles.firstBlock : null,
          ]}
        >
          <Inlines nodes={block.children} actions={actions} keyPrefix={path} />
        </Text>
      );
    case "code":
      return <CodeBlock text={block.text} lang={block.lang} actions={actions} copyKey={path} />;
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: colors.accent }]}>
          <Blocks blocks={block.children} actions={actions} path={path} />
        </View>
      );
    case "list":
      return <ListBlock block={block} actions={actions} path={path} />;
    case "table":
      return <TableBlock block={block} actions={actions} path={path} />;
    case "rule":
      return (
        <View
          style={[
            styles.rule,
            { backgroundColor: colors.outlineVariant },
            first ? styles.firstRule : null,
          ]}
        />
      );
    case "literal":
      return (
        <Text style={[styles.literal, { color: colors.onSurface }]} selectable>
          {block.text}
        </Text>
      );
    default:
      return null;
  }
}

function headingStyle(depth: 1 | 2 | 3 | 4 | 5 | 6) {
  const fontSize = depth === 1 ? 22 : depth === 2 ? 18 : depth === 3 ? 16 : 14;
  return {
    fontSize,
    lineHeight: fontSize + 6,
    fontWeight: "600" as const,
    marginTop: 8,
    marginBottom: 6,
  };
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
  const { colors } = actions;
  return (
    <View style={styles.list}>
      {block.items.map((item, index) => {
        const number = block.start + index;
        return (
          <View key={`${path}-${index}`} style={styles.listItem}>
            {item.checked === null ? (
              <Text style={[styles.marker, { color: colors.onSurfaceVariant }]}>
                {block.ordered ? `${number}.` : "•"}
              </Text>
            ) : (
              <TaskCheckbox
                checked={item.checked}
                colors={colors}
                onToggle={taskToggle(actions, item)}
              />
            )}
            <View style={styles.listBody}>
              <Blocks blocks={item.children} actions={actions} path={`${path}-${index}`} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function taskToggle(actions: PreviewActions, item: MarkdownListItem): (() => void) | null {
  const { toggleTask } = actions;
  const { taskOffset, checked } = item;
  if (!toggleTask || taskOffset === null || checked === null) return null;
  return () => toggleTask(taskOffset, checked);
}

function TaskCheckbox({
  checked,
  colors,
  onToggle,
}: {
  checked: boolean;
  colors: ThemeColors;
  onToggle: (() => void) | null;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !onToggle }}
      disabled={!onToggle}
      onPress={onToggle ?? undefined}
      hitSlop={10}
      style={[
        styles.checkbox,
        {
          borderColor: checked ? colors.accent : colors.outlineVariant,
          backgroundColor: checked ? colors.accent : "transparent",
        },
      ]}
    >
      {checked ? <Text style={[styles.check, { color: colors.accentForeground }]}>✓</Text> : null}
    </Pressable>
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
  const { colors } = actions;
  const border = { borderColor: colors.outlineVariant };
  return (
    <ScrollView horizontal style={styles.tableScroll}>
      <View>
        <View style={styles.tableRow}>
          {block.header.map((cell, index) => (
            <View
              key={`${path}-h-${index}`}
              style={[styles.cell, border, { backgroundColor: colors.surfaceContainerHighest }]}
            >
              <Text
                style={[
                  styles.cellText,
                  alignStyle(block.align[index] ?? null),
                  { color: colors.onSurface },
                ]}
              >
                <Inlines nodes={cell} actions={actions} keyPrefix={`${path}-h-${index}`} />
              </Text>
            </View>
          ))}
        </View>
        {block.rows.map((row, rowIndex) => (
          <View key={`${path}-r-${rowIndex}`} style={styles.tableRow}>
            {row.map((cell, index) => (
              <View key={`${path}-${rowIndex}-${index}`} style={[styles.cell, border]}>
                <Text
                  style={[
                    styles.cellText,
                    alignStyle(block.align[index] ?? null),
                    { color: colors.onSurface },
                  ]}
                >
                  <Inlines
                    nodes={cell}
                    actions={actions}
                    keyPrefix={`${path}-${rowIndex}-${index}`}
                  />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function alignStyle(align: MarkdownAlign) {
  if (align === "center") return { textAlign: "center" as const };
  if (align === "right") return { textAlign: "right" as const };
  return { textAlign: "left" as const };
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
  const { colors } = actions;
  const tint = copied ? colors.accent : colors.onSurfaceVariant;
  const label = copied ? actions.copiedLabel : actions.copyLabel;
  return (
    <View
      style={[
        styles.fence,
        {
          backgroundColor: colors.surfaceContainerHighest,
          borderColor: copied ? colors.accent : "transparent",
        },
      ]}
    >
      {lang ? <Text style={[styles.lang, { color: colors.onSurfaceVariant }]}>{lang}</Text> : null}
      <Text
        selectable
        onPress={() => actions.copyOnDoubleTap(copyKey, text)}
        style={[
          styles.fenceText,
          lang ? styles.fenceTextAfterLang : null,
          { color: colors.onSurface },
        ]}
      >
        {text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => actions.copy(copyKey, text)}
        style={styles.copyButton}
      >
        <Icon name="copy" size={12} color={tint} />
        <Text style={[styles.copyText, { color: tint }]}>{label}</Text>
      </Pressable>
    </View>
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
}): ReactNode {
  return nodes.map((node, index) => (
    <Inline
      key={`${keyPrefix}-${index}`}
      node={node}
      copyKey={`${keyPrefix}-${index}`}
      actions={actions}
    />
  ));
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
  const { colors } = actions;
  switch (node.type) {
    case "text":
      return node.text;
    case "break":
      return "\n";
    case "strong":
      return (
        <Text key={copyKey} style={styles.strong}>
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-s`} />
        </Text>
      );
    case "emphasis":
      return (
        <Text key={copyKey} style={styles.em}>
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-e`} />
        </Text>
      );
    case "strike":
      return (
        <Text key={copyKey} style={styles.strike}>
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-d`} />
        </Text>
      );
    case "link":
      return (
        <Text
          key={copyKey}
          onPress={() => openLink(node.href)}
          style={{ color: colors.accent, textDecorationLine: "underline" }}
        >
          <Inlines nodes={node.children} actions={actions} keyPrefix={`${copyKey}-a`} />
        </Text>
      );
    case "image":
      return (
        <Text key={copyKey} style={[styles.em, { color: colors.onSurfaceVariant }]}>
          {node.alt}
        </Text>
      );
    case "footnote":
      return (
        <Text
          key={copyKey}
          onPress={() => actions.onFootnote(node.id)}
          style={{ color: colors.accent, fontSize: 11 }}
        >
          {node.label}
        </Text>
      );
    case "code": {
      const copied = actions.copiedKey === copyKey;
      const label = copied ? actions.copiedLabel : actions.copyLabel;
      return (
        <Text key={copyKey}>
          <Text
            onPress={() => actions.copyOnDoubleTap(copyKey, node.text)}
            style={[
              styles.inlineCode,
              {
                backgroundColor: colors.surfaceContainerHighest,
                color: copied ? colors.accent : colors.onSurface,
              },
            ]}
          >
            {node.text}
          </Text>
          <Text
            selectable={false}
            onPress={() => actions.copy(copyKey, node.text)}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            {" "}
            <Icon name="copy" size={13} color={copied ? colors.accent : colors.onSurfaceVariant} />
          </Text>
        </Text>
      );
    }
    default:
      return null;
  }
}

function openLink(href: string) {
  const allowed = markdownLinkHref(href);
  if (!allowed) return;
  void Linking.openURL(allowed).catch(() => undefined);
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  center: { alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  body: { textAlign: "center", fontSize: 14, lineHeight: 20 },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28 },
  paragraph: { fontSize: 15, lineHeight: 22, marginBottom: 10 },
  strong: { fontWeight: "600" },
  em: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  inlineCode: { fontFamily: "monospace", fontSize: 13 },
  quote: { borderLeftWidth: 2, paddingLeft: 10, marginBottom: 10 },
  list: { marginBottom: 10 },
  listItem: { flexDirection: "row", alignItems: "flex-start", marginBottom: 4 },
  marker: { width: 22, fontSize: 15, lineHeight: 22 },
  checkbox: {
    width: 14,
    height: 14,
    marginTop: 4,
    marginRight: 8,
    borderWidth: 1,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { fontSize: 10, lineHeight: 12 },
  listBody: { flex: 1, minWidth: 0 },
  tableScroll: { marginBottom: 10 },
  tableRow: { flexDirection: "row" },
  cell: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 72,
  },
  cellText: { fontSize: 14, lineHeight: 20 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  firstRule: { marginTop: 4 },
  firstBlock: { marginTop: 0 },
  literal: { fontFamily: "monospace", fontSize: 13, lineHeight: 20, marginBottom: 10 },
  fence: { borderRadius: 8, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  lang: {
    fontFamily: "monospace",
    fontSize: 10,
    textTransform: "uppercase",
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  copyButton: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  copyText: { fontSize: 12, fontWeight: "600" },
  fenceText: {
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    paddingLeft: 10,
    /* Room for the copy button in the top-right corner. */
    paddingRight: 88,
    paddingTop: 10,
    paddingBottom: 10,
  },
  fenceTextAfterLang: { paddingTop: 4 },
  footnotes: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  noteTitle: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  note: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  noteLabel: { width: 22, fontSize: 13, lineHeight: 20 },
  noteBody: { flex: 1, minWidth: 0 },
});
