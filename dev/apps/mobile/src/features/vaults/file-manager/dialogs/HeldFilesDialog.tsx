import { type ReactNode, memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Checkbox, IconButton, Modal, ModalFooterActions } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import {
  HELD_FILE_STANDING_I18N_KEYS,
  fileBaseName,
  formatBytes,
  formatIsoDate,
  getParentPath,
  heldFileStanding,
  type HeldItem,
} from "@upriv/shared";
import { useHeldReview, type HeldDeleteAsk, type HeldReview } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

/**
 * The data a vault set aside because no file of its tree names it, laid out
 * like the Backups window. A file another copy of the vault names can be put
 * back or deleted; a piece nothing names can only be deleted. Items are
 * chosen one by one or all at once, and a delete asks in the footer first.
 */
export function HeldFilesDialog({ fm, open }: { fm: FileManagerApi; open: boolean }) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const { held } = fm;
  const summary = held.summary;
  const review = useHeldReview(held, (paths) =>
    fm.showToast(
      paths.length === 1
        ? t("modal.file_manager.held.put_back_toast", { path: paths[0] })
        : t("modal.file_manager.held.put_back_many_toast", { count: String(paths.length) }),
    ),
  );
  const asking = review.asking !== null;
  /** A single item has nothing to choose among: its row's buttons cover it. */
  const selectable = review.items.length > 1;

  return (
    <Modal
      open={open && held.open}
      title={t("modal.file_manager.held.title")}
      titleIcon="archive"
      panelClassName="max-w-2xl"
      onClose={() => held.show(false)}
      footer={
        review.asking ? (
          <DeleteQuestion
            asking={review.asking}
            onCancel={review.cancelDelete}
            onConfirm={review.confirmDelete}
          />
        ) : undefined
      }
    >
      {summary ? (
        <>
          <Text style={[typography.bodyMuted, styles.hint]}>
            {t("modal.file_manager.held.intro")}
          </Text>
          <View style={styles.list}>
            {selectable && !asking ? (
              <HeldToolbar
                review={review}
                onPutBack={() => review.putBack(review.selectedFiles)}
                onDelete={() => review.askDelete([...review.selected])}
              />
            ) : null}
            {summary.files.length > 0 ? (
              <HeldSection
                title={t("modal.file_manager.held.files_title")}
                help={t("modal.file_manager.held.files_help")}
              >
                {summary.files.map((item) => (
                  <HeldRow
                    key={item.name}
                    item={item}
                    checked={selectable && review.selected.has(item.name)}
                    selectable={selectable}
                    disabled={asking || held.working.has(item.name)}
                    onToggle={review.toggle}
                    onPutBack={review.putBack}
                    onDelete={review.askDelete}
                  />
                ))}
              </HeldSection>
            ) : null}
            {summary.pieces.length > 0 ? (
              <HeldSection
                title={t("modal.file_manager.held.pieces_title")}
                help={t("modal.file_manager.held.pieces_body", {
                  count: summary.pieces.length,
                  size: formatBytes(summary.pieceBytes),
                })}
                action={
                  <Button
                    label={t("modal.file_manager.held.pieces_delete")}
                    variant="danger"
                    size="sm"
                    disabled={
                      asking || summary.pieces.some((piece) => held.working.has(piece.name))
                    }
                    onPress={() => review.askDelete(summary.pieces.map((piece) => piece.name))}
                  />
                }
              >
                {summary.pieces.map((item) => (
                  <HeldRow
                    key={item.name}
                    item={item}
                    checked={selectable && review.selected.has(item.name)}
                    selectable={selectable}
                    disabled={asking || held.working.has(item.name)}
                    onToggle={review.toggle}
                    onPutBack={review.putBack}
                    onDelete={review.askDelete}
                  />
                ))}
              </HeldSection>
            ) : null}
          </View>
        </>
      ) : null}
    </Modal>
  );
}

function HeldToolbar({
  review,
  onPutBack,
  onDelete,
}: {
  review: HeldReview;
  onPutBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const count = review.selected.size;
  return (
    <View style={styles.toolbar}>
      <Pressable style={styles.toolbarSelect} onPress={review.toggleAll}>
        <Checkbox
          checked={review.allSelected}
          indeterminate={count > 0 && !review.allSelected}
          onChange={review.toggleAll}
          label={t("modal.file_manager.held.select_all")}
        />
        <Text style={typography.bodyMuted}>{t("modal.file_manager.held.select_all")}</Text>
      </Pressable>
      {count > 0 ? (
        <View style={styles.toolbarActions}>
          <Text style={[typography.caption, styles.selectedCount]}>
            {t("modal.file_manager.held.selected_count", { count: String(count) })}
          </Text>
          {review.selectedFiles.length > 0 ? (
            <IconButton
              label={t("modal.file_manager.held.put_back_selected")}
              icon="history"
              size={18}
              tone="muted"
              onPress={onPutBack}
            />
          ) : null}
          <IconButton
            label={t("modal.file_manager.held.delete_selected")}
            icon="trash"
            size={18}
            tone="muted"
            onPress={onDelete}
          />
        </View>
      ) : null}
    </View>
  );
}

function HeldSection({
  title,
  help,
  action,
  children,
}: {
  title: string;
  help: string;
  /** Beside the title, e.g. Delete pieces. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const { typography } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text style={[typography.body, { fontWeight: "500" }]}>{title}</Text>
          <Text style={[typography.caption, styles.sectionHelp]}>{help}</Text>
        </View>
        {action}
      </View>
      <View style={styles.sectionList}>{children}</View>
    </View>
  );
}

interface HeldRowProps {
  item: HeldItem;
  checked: boolean;
  selectable: boolean;
  disabled: boolean;
  onToggle: (name: string) => void;
  onPutBack: (names: readonly string[]) => void;
  onDelete: (names: readonly string[]) => void;
}

/** Drawn again only when its own props change: a vault may set aside hundreds of items. */
const HeldRow = memo(function HeldRow({
  item,
  checked,
  selectable,
  disabled,
  onToggle,
  onPutBack,
  onDelete,
}: HeldRowProps) {
  const { locale, t } = useTranslation();
  const { colors, typography } = useTheme();
  const { file } = item;
  const date = (ms: number) => formatIsoDate(new Date(ms).toISOString(), locale);
  const title = file ? fileBaseName(file.path) : t("modal.file_manager.held.piece");
  const meta = [
    file
      ? t("modal.file_manager.held.changed", { date: date(file.modifiedAt) })
      : t("modal.file_manager.held.set_aside", { date: date(item.heldAt) }),
    formatBytes(file?.size ?? item.size),
    ...(file ? [t(HELD_FILE_STANDING_I18N_KEYS[heldFileStanding(file)])] : []),
  ].join(" · ");
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor: checked ? colorAlpha(colors.accent, 0.4) : "transparent",
        },
      ]}
    >
      <View
        style={[styles.rowMain, { opacity: disabled ? 0.6 : 1 }]}
        pointerEvents={disabled ? "none" : "auto"}
      >
        {selectable ? (
          <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle(item.name)}
            label={title}
          />
        ) : null}
        <View style={[styles.rowIcon, { backgroundColor: colors.surfaceContainerHighest }]}>
          <Icon name={file ? "file" : "warning"} size={18} color={colors.onSurfaceVariant} />
        </View>
        <Pressable
          style={styles.rowCopy}
          onPress={() => onToggle(item.name)}
          disabled={disabled || !selectable}
        >
          <Text
            style={[typography.mono, { color: colors.onSurface }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {title}
          </Text>
          {file ? (
            <Text style={typography.caption} numberOfLines={1} ellipsizeMode="middle">
              {getParentPath(file.path)}
            </Text>
          ) : null}
          <Text style={typography.caption}>{meta}</Text>
        </Pressable>
        <View style={styles.rowActions}>
          {file ? (
            <IconButton
              label={t("modal.file_manager.held.put_back")}
              icon="history"
              size={18}
              tone="muted"
              disabled={disabled}
              onPress={() => onPutBack([item.name])}
            />
          ) : null}
          <IconButton
            label={t("action.delete")}
            icon="trash"
            size={18}
            tone="muted"
            disabled={disabled}
            onPress={() => onDelete([item.name])}
          />
        </View>
      </View>
    </View>
  );
});

function DeleteQuestion({
  asking,
  onCancel,
  onConfirm,
}: {
  asking: HeldDeleteAsk;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const count = asking.names.length;
  const size = formatBytes(asking.bytes);
  const question = asking.onlyPath
    ? t("modal.file_manager.held.delete_question_file", { name: fileBaseName(asking.onlyPath) })
    : asking.files === 0
      ? t("modal.file_manager.held.delete_question_pieces", { count, size })
      : t("modal.file_manager.held.delete_question_many", { count: String(count), size });
  return (
    <View style={styles.footerCol}>
      <View style={styles.question}>
        <Text style={typography.bodyMuted}>{question}</Text>
        <Text style={typography.bodyMuted}>{t("modal.file_manager.held.delete_irreversible")}</Text>
      </View>
      <ModalFooterActions layout="confirm">
        <Button label={t("action.delete")} variant="danger" onPress={onConfirm} />
        <Button label={t("action.cancel")} variant="ghost" onPress={onCancel} />
      </ModalFooterActions>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  list: { gap: spacing.lg },
  toolbar: {
    minHeight: 32,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  toolbarSelect: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0,
  },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  selectedCount: { paddingRight: spacing.xs },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionHelp: { marginTop: 2, lineHeight: 18 },
  sectionList: { gap: spacing.sm },
  row: { borderRadius: radii.md, borderWidth: 1 },
  rowMain: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowActions: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: spacing.xs },
  footerCol: { gap: spacing.md },
  question: { gap: spacing.xs },
});
