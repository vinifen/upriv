import { StyleSheet, Text, View } from "react-native";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  HELD_FILE_STANDING_I18N_KEYS,
  fileBaseName,
  formatBytes,
  formatIsoDate,
  getParentPath,
  heldFileStanding,
  type HeldFileItem,
} from "@upriv/shared";
import { useHeldReview, type HeldDeleteAsk } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

/**
 * The data a vault set aside because no file of its tree names it. A file an
 * index of the vault still names can be put back or deleted; pieces no index
 * names can only be deleted. A delete asks in the footer first.
 */
export function HeldFilesDialog({ fm, open }: { fm: FileManagerApi; open: boolean }) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const { held } = fm;
  const summary = held.summary;
  const review = useHeldReview(held, (path) =>
    fm.showToast(t("modal.file_manager.held.put_back_toast", { path })),
  );
  const border = { borderColor: colors.outlineVariant };

  return (
    <Modal
      open={open && held.open}
      title={t("modal.file_manager.held.title")}
      titleIcon="archive"
      panelClassName="max-w-lg"
      onClose={() => held.show(false)}
      footer={
        review.asking ? (
          <DeleteQuestion
            asking={review.asking}
            pieces={summary?.pieces.length ?? 0}
            pieceBytes={summary?.pieceBytes ?? 0}
            onCancel={review.cancelDelete}
            onConfirm={review.confirmDelete}
          />
        ) : (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.close")}
              variant="ghost"
              size="sm"
              onPress={() => held.show(false)}
            />
          </ModalFooterActions>
        )
      }
    >
      {summary ? (
        <View style={styles.body}>
          <Text style={typography.bodyMuted}>{t("modal.file_manager.held.intro")}</Text>
          {summary.files.length > 0 ? (
            <View style={[styles.list, border]}>
              {summary.files.map((item, index) => (
                <HeldFileRow
                  key={item.name}
                  item={item}
                  first={index === 0}
                  working={held.working.has(item.name)}
                  onPutBack={() => review.putBack(item)}
                  onDelete={() => review.askDeleteFile(item)}
                />
              ))}
            </View>
          ) : null}
          {summary.pieces.length > 0 ? (
            <View style={[styles.pieces, border]}>
              <Text style={[typography.body, styles.piecesTitle]}>
                {t("modal.file_manager.held.pieces_title")}
              </Text>
              <Text style={typography.caption}>
                {t("modal.file_manager.held.pieces_body", {
                  count: summary.pieces.length,
                  size: formatBytes(summary.pieceBytes),
                })}
              </Text>
              <View style={styles.actions}>
                <Button
                  label={t("modal.file_manager.held.pieces_delete")}
                  variant="danger"
                  size="sm"
                  disabled={review.piecesWorking}
                  onPress={review.askDeletePieces}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

function DeleteQuestion({
  asking,
  pieces,
  pieceBytes,
  onCancel,
  onConfirm,
}: {
  asking: HeldDeleteAsk;
  pieces: number;
  pieceBytes: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const question =
    asking.kind === "file"
      ? t("modal.file_manager.held.delete_question_file", {
          name: fileBaseName(asking.item.file.path),
        })
      : t("modal.file_manager.held.delete_question_pieces", {
          count: pieces,
          size: formatBytes(pieceBytes),
        });
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

function HeldFileRow({
  item,
  first,
  working,
  onPutBack,
  onDelete,
}: {
  item: HeldFileItem;
  first: boolean;
  working: boolean;
  onPutBack: () => void;
  onDelete: () => void;
}) {
  const { locale, t } = useTranslation();
  const { typography, colors } = useTheme();
  const { file } = item;
  return (
    <View
      style={[
        styles.row,
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth },
        { borderColor: colors.outlineVariant },
      ]}
    >
      <Text style={[typography.mono, { color: colors.onSurface }]} numberOfLines={1}>
        {fileBaseName(file.path)}
      </Text>
      <Text style={typography.caption} numberOfLines={1}>
        {getParentPath(file.path)}
      </Text>
      <Text style={typography.caption}>
        {[
          t("modal.file_manager.held.changed", {
            date: formatIsoDate(new Date(file.modifiedAt).toISOString(), locale),
          }),
          formatBytes(file.size),
          t(HELD_FILE_STANDING_I18N_KEYS[heldFileStanding(file)]),
        ].join(" · ")}
      </Text>
      <View style={styles.actions}>
        <Button
          label={t("modal.file_manager.held.put_back")}
          variant="secondary"
          size="sm"
          disabled={working}
          onPress={onPutBack}
        />
        <Button
          label={t("action.delete")}
          variant="danger"
          size="sm"
          disabled={working}
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  row: { gap: 2, padding: 12 },
  pieces: { gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 12 },
  piecesTitle: { fontWeight: "500" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  footerCol: { gap: 12 },
  question: { gap: 4 },
});
