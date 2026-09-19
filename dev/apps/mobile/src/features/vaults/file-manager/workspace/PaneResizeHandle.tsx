import { useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface PaneResizeHandleProps {
  axis: "x" | "y";
  onDragStart?: () => void;
  /** Pixel delta from the grab point (not the pointer's absolute position). */
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
}

/** Desktop `PaneResizeHandle` parity — grip icon with line segments that stop at the icon. */
export function PaneResizeHandle({ axis, onDragStart, onDrag, onDragEnd }: PaneResizeHandleProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [active, setActive] = useState(false);
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const axisRef = useRef(axis);
  axisRef.current = axis;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      // Never steal a scroll/pan that began in the tree or editor.
      onMoveShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        setActive(true);
        onDragStartRef.current?.();
      },
      onPanResponderMove: (_event, gesture) => {
        onDragRef.current(axisRef.current === "y" ? gesture.dy : gesture.dx);
      },
      onPanResponderRelease: () => {
        setActive(false);
        onDragEndRef.current?.();
      },
      onPanResponderTerminate: () => {
        setActive(false);
        onDragEndRef.current?.();
      },
    }),
  ).current;

  const isColumn = axis === "y";
  /** Idle: line + grip invisible (hit size unchanged). Visible while dragging. */
  const lineTone = active ? colors.accent : "transparent";
  const iconTone = active ? colors.accent : "transparent";
  const iconSize = isColumn ? 14 : 12;

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.hit, isColumn ? styles.hitY : styles.hitX, isColumn ? styles.row : styles.col]}
      accessibilityRole="adjustable"
      accessibilityLabel={t("modal.file_manager.split.resize")}
    >
      <View
        pointerEvents="none"
        style={[
          styles.segment,
          isColumn ? styles.segmentY : styles.segmentX,
          { backgroundColor: lineTone },
        ]}
      />
      <View
        pointerEvents="none"
        style={[isColumn ? styles.gripRotate : undefined, { opacity: active ? 1 : 0 }]}
      >
        <Icon name="grip-vertical" size={iconSize} color={iconTone} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.segment,
          isColumn ? styles.segmentY : styles.segmentX,
          { backgroundColor: lineTone },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    zIndex: 1,
    gap: 4,
  },
  hitY: { height: 8, width: "100%" },
  hitX: { width: 8, height: "100%" },
  row: { flexDirection: "row" },
  col: { flexDirection: "column" },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderRadius: 999,
  },
  segmentY: { height: StyleSheet.hairlineWidth * 2 },
  segmentX: { width: StyleSheet.hairlineWidth * 2 },
  gripRotate: { transform: [{ rotate: "90deg" }] },
});
