import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputScrollEventData,
  type TextLayoutEventData,
} from "react-native";
import {
  activeOutlineIndex,
  editorBlocks,
  gutterLabels,
  lineFirstRows,
  lineStartOffsets,
  matchesBySpan,
  rowStartsByLine,
  SINGLE_ROW,
  spanAt,
  type IndexedMatch,
  type LineRows,
  type TextMatch,
} from "@upriv/shared";
import { noteIdleActivity } from "@/lib/idleActivity";
import { useTheme } from "@/theme";
import { colorAlpha } from "@/theme/tokens";

const EDITOR_FONT_SIZE = 13;
const EDITOR_LINE_HEIGHT = 20;
const GUTTER_FONT_SIZE = 9;
const GUTTER_INSET = 3;
const GUTTER_TEXT_GAP = 4;
const GUTTER_DIGIT_WIDTH = 7;
const PADDING_TOP = 4;
const PADDING_RIGHT = 12;
/** Space kept above a line the editor scrolls to. */
const REVEAL_MARGIN = 40;
/** Monospace advance before the real one is measured: 0.6 em. */
const FALLBACK_CHAR_WIDTH = EDITOR_FONT_SIZE * 0.6;
/** Short enough to stay on one row on the narrowest phone. */
const CHAR_PROBE = "0".repeat(16);
const NO_MATCHES: readonly IndexedMatch[] = [];

export interface CodeEditorHandle {
  /** Scroll the row holding `offset` near the top, without focusing the input. */
  revealOffset: (offset: number) => void;
}

interface CodeEditorProps {
  /** The stored text: what the input starts from, and starts again from when it changes elsewhere. */
  content: string;
  /** `content` as line numbers and highlights draw it; trails typing by a render. */
  shownContent: string;
  ariaLabel: string;
  readOnly: boolean;
  wordWrap: boolean;
  /** Search matches in `shownContent`. */
  matches: readonly TextMatch[];
  activeMatchIndex: number;
  /** Offsets of the outline's headings, to mark the one the scroll has reached. */
  headingOffsets: readonly number[];
  onChange: (content: string) => void;
  onActiveHeading: (index: number) => void;
  /** The user started scrolling by hand. */
  onUserScroll: () => void;
}

interface MirrorBlockProps {
  block: number;
  text: string;
  lineCount: number;
  matches: readonly IndexedMatch[];
  /** Index of the current match, when it is in this block; -1 otherwise. */
  activeMatch: number;
  matchColor: string;
  activeColor: string;
  onRows: (block: number, rows: number[][] | null) => void;
}

/**
 * A block of lines of the hidden copy behind the input. It wraps like the
 * input, reports where each line's rows start, and paints the search
 * highlights under the input's text.
 */
const MirrorBlock = memo(function MirrorBlock({
  block,
  text,
  lineCount,
  matches,
  activeMatch,
  matchColor,
  activeColor,
  onRows,
}: MirrorBlockProps) {
  const pieces: React.ReactNode[] = [];
  let from = 0;
  for (const match of matches) {
    if (match.start > from) pieces.push(text.slice(from, match.start));
    pieces.push(
      <Text
        key={match.index}
        style={{ backgroundColor: match.index === activeMatch ? activeColor : matchColor }}
      >
        {text.slice(match.start, match.end)}
      </Text>,
    );
    from = match.end;
  }
  if (from < text.length) pieces.push(text.slice(from));

  return (
    <Text
      allowFontScaling={false}
      textBreakStrategy="simple"
      style={styles.mirrorText}
      onTextLayout={(event: NativeSyntheticEvent<TextLayoutEventData>) =>
        onRows(
          block,
          rowStartsByLine(
            event.nativeEvent.lines.map((row) => row.text),
            lineCount,
          ),
        )
      }
    >
      {text.length > 0 ? pieces : "​"}
    </Text>
  );
});

/** Columns of the longest line. A tab counts as a whole 8-column stop, so the width never falls short. */
function widestColumns(text: string): number {
  let widest = 0;
  let width = 0;
  for (const char of text) {
    if (char === "\n") {
      if (width > widest) widest = width;
      width = 0;
    } else {
      width = char === "\t" ? width + 8 - (width % 8) : width + 1;
    }
  }
  return Math.max(widest, width);
}

/**
 * Code view on a phone. The input grows with its text inside one scroll view,
 * so line numbers, highlights, and jumps scroll with it. A hidden copy behind
 * it, laid out in blocks of lines, tells which rows each line wraps to. The
 * input keeps its own text: a key is not sent back across the bridge, and
 * text from elsewhere (a read after the tree changed, a discard, a task ticked
 * in Read) starts it again.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    content,
    shownContent,
    ariaLabel,
    readOnly,
    wordWrap,
    matches,
    activeMatchIndex,
    headingOffsets,
    onChange,
    onActiveHeading,
    onUserScroll,
  },
  ref,
) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const sideScrollRef = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [charWidth, setCharWidth] = useState(FALLBACK_CHAR_WIDTH);
  const typedRef = useRef(content);
  // The text the input starts from goes in as its child, not `defaultValue`:
  // on Android a value prop keeps every earlier revision of the input's native
  // state alive, and dropping that chain after a long edit overflows the
  // native stack (react-native#58020). A child's text does not hold the state.
  const [start, setStart] = useState({ text: content, generation: 0 });
  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const focusedRef = useRef(false);
  /** Caret and focus to put back on the input started again by `resetInnerScroll`. */
  const resumeRef = useRef<{ selection: { start: number; end: number }; focused: boolean } | null>(
    null,
  );
  // The wrap toggle moves the input to another parent, which mounts it again.
  // It starts from what was typed, with the same caret and focus.
  const [wrapAtStart, setWrapAtStart] = useState(wordWrap);
  if (wrapAtStart !== wordWrap) {
    setWrapAtStart(wordWrap);
    resumeRef.current = { selection: selectionRef.current, focused: focusedRef.current };
    setStart((current) => ({ text: typedRef.current, generation: current.generation + 1 }));
  }
  const blockRowsRef = useRef<(number[][] | null)[]>([]);
  const [blockRows, setBlockRows] = useState<readonly (number[][] | null)[]>([]);
  const flushRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (content === typedRef.current) return;
    typedRef.current = content;
    setStart((current) => ({ text: content, generation: current.generation + 1 }));
  }, [content]);

  useEffect(
    () => () => {
      if (flushRef.current !== null) cancelAnimationFrame(flushRef.current);
    },
    [],
  );

  useEffect(() => {
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (!resume) return;
    if (resume.focused) inputRef.current?.focus();
    inputRef.current?.setSelection(resume.selection.start, resume.selection.end);
  }, [start.generation]);

  /**
   * A paste taller than the room under the text still makes the input scroll
   * inside itself. Start it again at the top, with the same caret and focus.
   */
  const resetInnerScroll = (event: NativeSyntheticEvent<TextInputScrollEventData>) => {
    if (event.nativeEvent.contentOffset.y <= 0 || resumeRef.current) return;
    resumeRef.current = { selection: selectionRef.current, focused: focusedRef.current };
    setStart((current) => ({ text: typedRef.current, generation: current.generation + 1 }));
  };

  const lineStarts = useMemo(() => lineStartOffsets(shownContent), [shownContent]);
  const blocks = useMemo(() => editorBlocks(shownContent, lineStarts), [lineStarts, shownContent]);
  const blockStarts = useMemo(() => blocks.map((block) => block.start), [blocks]);
  const blockMatches = useMemo(() => matchesBySpan(blockStarts, matches), [blockStarts, matches]);
  const activeBlock =
    matches[activeMatchIndex] !== undefined
      ? spanAt(blockStarts, matches[activeMatchIndex].start)
      : -1;

  /** One block's layout landed; the rows are read once per frame. */
  const onRows = useCallback((block: number, rows: number[][] | null) => {
    blockRowsRef.current[block] = rows;
    if (flushRef.current !== null) return;
    flushRef.current = requestAnimationFrame(() => {
      flushRef.current = null;
      setBlockRows([...blockRowsRef.current]);
    });
  }, []);

  const lineRows: LineRows = useMemo(() => {
    const rows: (readonly number[])[] = [];
    blocks.forEach(({ lineCount }, block) => {
      const laidOut = blockRows[block];
      for (let line = 0; line < lineCount; line += 1) {
        rows.push(laidOut && laidOut.length === lineCount ? laidOut[line] : SINGLE_ROW);
      }
    });
    return rows;
  }, [blockRows, blocks]);
  const firstRows = useMemo(() => lineFirstRows(lineRows), [lineRows]);
  const gutterText = useMemo(() => gutterLabels(lineRows), [lineRows]);
  // The last line can scroll up to the top. That room also takes the rows a
  // key adds before the layout catches up, so the input does not scroll inside
  // itself, away from the line numbers (Android ignores `scrollEnabled` here).
  const inputHeight =
    PADDING_TOP +
    firstRows[firstRows.length - 1] * EDITOR_LINE_HEIGHT +
    Math.max(EDITOR_LINE_HEIGHT, viewport.height - EDITOR_LINE_HEIGHT);

  const gutterWidth = Math.max(2, String(lineStarts.length).length) * GUTTER_DIGIT_WIDTH;
  const gutterSpace = GUTTER_INSET + gutterWidth + GUTTER_TEXT_GAP;
  const unwrappedWidth = useMemo(
    () =>
      wordWrap ? 0 : Math.ceil(widestColumns(shownContent) * charWidth) + PADDING_RIGHT + charWidth,
    [charWidth, shownContent, wordWrap],
  );

  /** Top of the row holding `offset`, in scroll content px. */
  const offsetTop = useCallback(
    (offset: number) => {
      const line = spanAt(lineStarts, offset);
      const row = firstRows[line] + spanAt(lineRows[line], offset - lineStarts[line]);
      return PADDING_TOP + row * EDITOR_LINE_HEIGHT;
    },
    [firstRows, lineRows, lineStarts],
  );

  useImperativeHandle(
    ref,
    () => ({
      revealOffset: (offset) => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, offsetTop(offset) - REVEAL_MARGIN),
          animated: true,
        });
        if (!wordWrap) {
          const column = offset - lineStarts[spanAt(lineStarts, offset)];
          sideScrollRef.current?.scrollTo({
            x: Math.max(0, column * charWidth - REVEAL_MARGIN),
            animated: true,
          });
        }
      },
    }),
    [charWidth, lineStarts, offsetTop, wordWrap],
  );

  const reportHeading = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (headingOffsets.length === 0) return;
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    onActiveHeading(
      activeOutlineIndex(headingOffsets.map(offsetTop), {
        offset: contentOffset.y,
        viewport: layoutMeasurement.height,
        content: contentSize.height,
      }),
    );
  };

  const matchColor = colorAlpha(colors.accent, 0.3);
  const activeColor = colorAlpha(colors.accent, 0.7);
  const mirror = (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.mirror]}>
      {blocks.map(({ text, lineCount }, block) => (
        <MirrorBlock
          key={block}
          block={block}
          text={text}
          lineCount={lineCount}
          matches={blockMatches.get(block) ?? NO_MATCHES}
          activeMatch={block === activeBlock ? activeMatchIndex : -1}
          matchColor={matchColor}
          activeColor={activeColor}
          onRows={onRows}
        />
      ))}
    </View>
  );

  const input = (
    <TextInput
      key={start.generation}
      ref={inputRef}
      editable={!readOnly}
      onScroll={resetInnerScroll}
      onSelectionChange={(event) => {
        selectionRef.current = event.nativeEvent.selection;
      }}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
      }}
      onChangeText={(text) => {
        if (readOnly) {
          // A key that landed as the editor locked is not stored: show the stored text again.
          setStart((current) => ({
            text: typedRef.current,
            generation: current.generation + 1,
          }));
          return;
        }
        noteIdleActivity();
        typedRef.current = text;
        onChange(text);
      }}
      multiline
      scrollEnabled={false}
      blurOnSubmit={false}
      importantForAutofill="no"
      spellCheck={false}
      autoCorrect={false}
      autoCapitalize="none"
      textAlignVertical="top"
      textBreakStrategy="simple"
      underlineColorAndroid="transparent"
      allowFontScaling={false}
      accessibilityLabel={ariaLabel}
      style={[
        styles.input,
        { color: colors.onSurface, minHeight: inputHeight },
        wordWrap ? null : { width: Math.max(unwrappedWidth, viewport.width - gutterSpace) },
      ]}
    >
      {start.text}
    </TextInput>
  );

  return (
    <View
      style={[styles.root, { backgroundColor: colors.surfaceContainerHigh }]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setViewport((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }}
    >
      <Text
        allowFontScaling={false}
        style={[styles.mirrorText, styles.probe]}
        onLayout={(event) => setCharWidth(event.nativeEvent.layout.width / CHAR_PROBE.length)}
      >
        {CHAR_PROBE}
      </Text>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={onUserScroll}
        onScrollEndDrag={reportHeading}
        onMomentumScrollEnd={reportHeading}
      >
        <View style={styles.row}>
          <View style={[styles.numberColumn, { width: gutterSpace }]}>
            <Text
              allowFontScaling={false}
              style={[styles.numbers, { width: gutterWidth, color: colors.editorGutterMuted }]}
            >
              {gutterText}
            </Text>
          </View>
          {wordWrap ? (
            <View style={styles.wrapColumn}>
              {mirror}
              {input}
            </View>
          ) : (
            <ScrollView
              ref={sideScrollRef}
              horizontal
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={onUserScroll}
              style={styles.wrapColumn}
            >
              <View>
                {mirror}
                {input}
              </View>
            </ScrollView>
          )}
        </View>
      </ScrollView>
    </View>
  );
});

/* Copy, input, and numbers drop the font padding, so every row is one line height. */
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: "hidden" },
  probe: { position: "absolute", opacity: 0, left: 0, top: 0 },
  row: { flexDirection: "row" },
  numberColumn: { paddingTop: PADDING_TOP, paddingLeft: GUTTER_INSET, flexShrink: 0 },
  numbers: {
    fontFamily: "monospace",
    fontSize: GUTTER_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    includeFontPadding: false,
    textAlign: "right",
  },
  wrapColumn: { flex: 1, minWidth: 0 },
  mirror: { paddingTop: PADDING_TOP, paddingRight: PADDING_RIGHT },
  mirrorText: {
    fontFamily: "monospace",
    fontSize: EDITOR_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    includeFontPadding: false,
    color: "transparent",
  },
  input: {
    paddingTop: PADDING_TOP,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: PADDING_RIGHT,
    fontFamily: "monospace",
    fontSize: EDITOR_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    includeFontPadding: false,
    backgroundColor: "transparent",
    textAlignVertical: "top",
  },
});
