import { StyleSheet, Text, View } from "react-native";
import { IMPORT_BLOCK_REASON_I18N, type ImportBlockedReport } from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

interface ImportBlockedModalProps {
  /** `null` while no import has items to name. */
  report: ImportBlockedReport | null;
  /** Import again, without the items that cannot be imported. A refused import needs it. */
  onLeaveOut?: () => void;
  /** Closed: a refused import stays cancelled. */
  onClose: () => void;
}

/**
 * The items an import could not take (desktop `ImportBlockedModal` parity),
 * each named with why, from the chosen file or folder; the window scrolls,
 * and a line counts the ones not named. Refused, nothing was imported: the
 * person cancels or imports without them, and when the chosen item itself is
 * one, only Close is left. Left out, the rest is in the vault, and the window
 * only reports them.
 */
export function ImportBlockedModal({ report, onLeaveOut, onClose }: ImportBlockedModalProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const blocked = report?.blocked;
  const more = blocked ? blocked.count - blocked.items.length : 0;
  const leftOut = report?.stage === "left_out";
  const closeOnly = leftOut || (blocked?.whole ?? false) || !onLeaveOut;
  const body = leftOut
    ? "modal.import_blocked.body_left_out"
    : blocked?.whole
      ? "modal.import_blocked.body_whole"
      : "modal.import_blocked.body";
  const count =
    blocked?.count === 1
      ? t(leftOut ? "modal.import_blocked.count_left_out_one" : "modal.import_blocked.count_one")
      : t(leftOut ? "modal.import_blocked.count_left_out" : "modal.import_blocked.count", {
          count: String(blocked?.count ?? 0),
        });
  const title = t(leftOut ? "modal.import_blocked.title_left_out" : "modal.import_blocked.title");
  return (
    <Modal
      open={report !== null}
      title={title}
      titleIcon="warning"
      contextTitle={report?.vaultName}
      onClose={onClose}
      footer={
        <ModalFooterActions layout="dialog">
          {closeOnly ? (
            <Button label={t("action.close")} variant="primary" size="sm" onPress={onClose} />
          ) : (
            <>
              <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={onClose} />
              <Button
                label={t("modal.import_blocked.leave_out")}
                variant="primary"
                size="sm"
                onPress={onLeaveOut}
              />
            </>
          )}
        </ModalFooterActions>
      }
    >
      {blocked ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>{t(body)}</Text>
          <Text style={[typography.body, { color: colors.onSurface }]}>{count}</Text>
          <View
            accessibilityLabel={title}
            style={[styles.list, { backgroundColor: colors.surfaceContainer }]}
          >
            {blocked.items.map((item, index) => (
              <View
                key={`${index}:${item.path}`}
                style={[
                  styles.item,
                  index > 0 ? { borderTopColor: colors.outlineVariant, borderTopWidth: 1 } : null,
                ]}
              >
                <Text style={[typography.mono, { color: colors.onSurface }]}>{item.path}</Text>
                <Text style={typography.caption}>{t(IMPORT_BLOCK_REASON_I18N[item.reason])}</Text>
              </View>
            ))}
          </View>
          {more > 0 ? (
            <Text style={typography.caption}>
              {more === 1
                ? t("modal.import_blocked.more_one")
                : t("modal.import_blocked.more", { count: String(more) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  list: { borderRadius: radii.md, overflow: "hidden" },
  item: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
