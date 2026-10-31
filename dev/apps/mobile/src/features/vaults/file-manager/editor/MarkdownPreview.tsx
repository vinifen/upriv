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
  activeOutlineIndex,
  MARKDOWN_COPY_DOUBLE_TAP_MS,
  markdownLinkHref,
  previewSearchMatches,
  toggleMarkdownTask,
  type MarkdownAlign,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownListItem,
  type MarkdownParser,
  type PreviewSearch,
  type PreviewTextNode,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme, type ThemeColors } from "@/theme";
import { colorAlpha } from "@/theme/tokens";

const COPIED_MS = 1600;
/** Space kept above a block the view scrolls to. */
const REVEAL_MARGIN = 8;

interface MarkdownPreviewProps {
  markdown: string;
  parser: MarkdownParser;
  onCopyFailed: () => void;
  /** Task checkbox edits. Omit for a read-only note (checkboxes stay disabled). */
  onChange?: (markdown: string) => void;
  onActiveHeadingChange?: (index: number) => void;
  /** The user started scrolling by hand. */
  onUserScroll?: () => void;
  searchQuery?: string;
  searchActiveIndex?: number;
  onMatchCountChange?: (count: number) => void;
}

interface PreviewActions {
  colors: ThemeColors;
  search: PreviewSearch;
  activeMatch: number;
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
  /** The n-th search match, in reading order. */
  scrollToMatch: (index: number) => void;
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
  onActiveHeadingChange,
  onUserScroll,
  searchQuery = "",
  searchActiveIndex = 0,
  onMatchCountChange,
  handleRef,
}: MarkdownPreviewProps & { handleRef: ForwardedRef<MarkdownPreviewHandle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const model = useMemo(() => parser.note(markdown).document, [markdown, parser]);
  const search = useMemo(() => previewSearchMatches(model, searchQuery), [model, searchQuery]);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef(0);
  const noteY = useRef(new Map<string, number>());
  /** Top-level block index → y in the scroll content. */
  const blockY = useRef(new Map<number, number>());
  /** Top-level block index of each outline entry, in order. */
  const headingBlocks = useMemo(
    () =>
      model.status === "ok"
        ? model.blocks.flatMap((block, index) => (block.type === "heading" ? [index] : []))
        : [],
    [model],
  );

  useEffect(() => {
    onMatchCountChange?.(search.sectionOfMatch.length);
  }, [onMatchCountChange, search]);

  const scrollToY = (y: number | undefined) => {
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - REVEAL_MARGIN), animated: true });
  };

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToHeading: (index) => scrollToY(blockY.current.get(headingBlocks[index] ?? -1)),
      scrollToMatch: (index) => {
        if (model.status !== "ok") return;
        const section = search.sectionOfMatch[index];
        if (section === undefined) return;
        const footnote = model.footnotes[section - model.blocks.length];
        scrollToY(
          footnote
            ? sectionY.current + (noteY.current.get(footnote.id) ?? 0)
            : blockY.current.get(section),
        );
      },
    }),
    [headingBlocks, model, search],
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
    search,
    activeMatch: searchActiveIndex,
    copiedKey,
    copy,
    copyOnDoubleTap,
    copyLabel: t("modal.file_manager.markdown.copy"),
    copiedLabel: t("modal.file_manager.markdown.copied"),
    onFootnote: (id) => scrollToY(sectionY.current + (noteY.current.get(id) ?? 0)),
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
      scrollEventThrottle={16}
      onScrollBeginDrag={onUserScroll}
      onScroll={(event) => {
        if (!onActiveHeadingChange || headingBlocks.length === 0) return;
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        onActiveHeadingChange(
          activeOutlineIndex(
            headingBlocks.map((block) => blockY.current.get(block)),
            {
              offset: contentOffset.y,
              viewport: layoutMeasurement.height,
              content: contentSize.height,
            },
          ),
        );
      }}
    >
      <Blocks
        blocks={model.blocks}
        actions={actions}
        path="doc"
        onBlockLayout={(index, y) => blockY.current.set(index, y)}
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

/**
 * `onBlockLayout`: top level only, where the outline and search scroll to.
 * Each top-level block then sits in a view that reports its position.
 */
function Blocks({
  blocks,
  actions,
  path,
  onBlockLayout,
}: {
  blocks: MarkdownBlock[];
  actions: PreviewActions;
  path: string;
  onBlockLayout?: (blockIndex: number, y: number) => void;
}) {
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        const content = (
          <Block
            key={key}
            block={block}
            actions={actions}
            path={`${path}-${index}`}
            first={index === 0}
          />
        );
        if (!onBlockLayout) return content;
        return (
          <View key={key} onLayout={(event) => onBlockLayout(index, event.nativeEvent.layout.y)}>
            {content}
          </View>
        );
      })}
    </>
  );
}

function Block({
  block,
  actions,
  path,
  first,
}: {
  block: MarkdownBlock;
  actions: PreviewActions;
  path: string;
  first: boolean;
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
      return <CodeBlock block={block} actions={actions} copyKey={path} />;
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
          {highlighted(block, actions)}
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

/** `node`'s text with its search matches marked; the current one stronger. */
function highlighted(node: PreviewTextNode, actions: PreviewActions): ReactNode {
  const text = node.type === "image" ? node.alt : node.text;
  const matches = actions.search.byNode.get(node);
  if (!matches) return text;
  const pieces: ReactNode[] = [];
  let from = 0;
  for (const match of matches) {
    if (match.start > from) pieces.push(text.slice(from, match.start));
    pieces.push(
      <Text
        key={match.index}
        style={{
          backgroundColor: colorAlpha(
            actions.colors.accent,
            match.index === actions.activeMatch ? 0.7 : 0.3,
          ),
        }}
      >
        {text.slice(match.start, match.end)}
      </Text>,
    );
    from = match.end;
  }
  if (from < text.length) pieces.push(text.slice(from));
  return pieces;
}

function CodeBlock({
  block,
  actions,
  copyKey,
}: {
  block: Extract<MarkdownBlock, { type: "code" }>;
  actions: PreviewActions;
  copyKey: string;
}) {
  const { text, lang } = block;
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
        {highlighted(block, actions)}
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
      return highlighted(node, actions);
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
          {highlighted(node, actions)}
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
            {highlighted(node, actions)}
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
