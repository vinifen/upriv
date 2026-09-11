import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { spacing } from "@/theme/tokens";

/**
 * Modal footer action layouts — match desktop `sm+` (not the stacked narrow fallback).
 *
 * - `confirm` (Pattern A): `row-reverse` so primary/danger (first in DOM) sits on the right;
 *   cancel to its left. Auto-width buttons (`sm:[&_button]:w-auto`).
 * - `dialog` (Pattern B): row, `justify-end`, cancel then primary in DOM.
 */
export type ModalFooterActionsLayout = "confirm" | "dialog";

interface ModalFooterActionsProps {
  layout: ModalFooterActionsLayout;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ModalFooterActions({ layout, children, style }: ModalFooterActionsProps) {
  return (
    <View style={[layout === "confirm" ? styles.confirm : styles.dialog, style]}>{children}</View>
  );
}

/**
 * Kept for call-site compatibility. Desktop `sm+` uses auto-width buttons — do not stretch.
 */
export const modalFooterConfirmBtnStyle: ViewStyle = {};

/**
 * Create-vault / wizard footer — desktop Pattern C at `sm+`:
 * Back on the left; cancel + next/create on the right (row, not stacked).
 */
export function ModalFooterNav({
  leading,
  trailing,
  style,
}: {
  leading?: ReactNode;
  trailing: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.nav, style]}>
      {leading ? <View style={styles.navLeading}>{leading}</View> : null}
      <View style={styles.navTrailing}>{trailing}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  confirm: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "stretch",
  },
  dialog: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "stretch",
  },
  nav: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    alignSelf: "stretch",
  },
  navLeading: {
    flexShrink: 1,
    minWidth: 0,
  },
  navTrailing: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 0,
  },
});
