import { Button, Modal } from "@/components/ui";
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
import type { FileManagerApi } from "../hooks/useVaultFileManager";

/**
 * The data a vault set aside because no file of its tree names it. A file an
 * index of the vault still names can be put back or deleted; pieces no index
 * names can only be deleted. A delete asks in the footer first.
 */
export function HeldFilesDialog({ fm, open }: { fm: FileManagerApi; open: boolean }) {
  const { t } = useTranslation();
  const { held } = fm;
  const summary = held.summary;
  const review = useHeldReview(held, (path) =>
    fm.showToast(t("modal.file_manager.held.put_back_toast", { path })),
  );

  return (
    <Modal
      open={open && held.open}
      title={t("modal.file_manager.held.title")}
      titleIcon="archive"
      onClose={() => held.show(false)}
      panelClassName="max-w-lg"
      rootClassName="z-[120]"
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
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => held.show(false)}>
              {t("action.close")}
            </Button>
          </div>
        )
      }
    >
      {summary ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("modal.file_manager.held.intro")}
          </p>
          {summary.files.length > 0 ? (
            <ul className="flex flex-col divide-y divide-outline-variant/30 rounded-lg border border-outline-variant/30">
              {summary.files.map((item) => (
                <HeldFileRow
                  key={item.name}
                  item={item}
                  working={held.working.has(item.name)}
                  onPutBack={() => review.putBack(item)}
                  onDelete={() => review.askDeleteFile(item)}
                />
              ))}
            </ul>
          ) : null}
          {summary.pieces.length > 0 ? (
            <section className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 p-3">
              <h3 className="text-sm font-medium text-on-surface">
                {t("modal.file_manager.held.pieces_title")}
              </h3>
              <p className="text-xs leading-relaxed text-on-surface-variant">
                {t("modal.file_manager.held.pieces_body", {
                  count: summary.pieces.length,
                  size: formatBytes(summary.pieceBytes),
                })}
              </p>
              <div className="flex justify-end">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={review.piecesWorking}
                  onClick={review.askDeletePieces}
                >
                  {t("modal.file_manager.held.pieces_delete")}
                </Button>
              </div>
            </section>
          ) : null}
        </div>
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
    <div className="flex flex-col gap-3">
      <div className="text-sm" aria-live="polite">
        <p className="text-on-surface-variant">{question}</p>
        <p className="mt-1 text-on-surface-variant">
          {t("modal.file_manager.held.delete_irreversible")}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
        <Button variant="danger" size="sm" onClick={onConfirm}>
          {t("action.delete")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("action.cancel")}
        </Button>
      </div>
    </div>
  );
}

function HeldFileRow({
  item,
  working,
  onPutBack,
  onDelete,
}: {
  item: HeldFileItem;
  working: boolean;
  onPutBack: () => void;
  onDelete: () => void;
}) {
  const { locale, t } = useTranslation();
  const { file } = item;
  const folder = getParentPath(file.path);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-on-surface sm:text-sm" title={file.path}>
          {fileBaseName(file.path)}
        </p>
        <p className="mt-0.5 truncate text-xs text-on-surface-variant" title={folder}>
          {folder}
        </p>
        <p className="mt-0.5 text-xs text-on-surface-variant">
          {t("modal.file_manager.held.changed", {
            date: formatIsoDate(new Date(file.modifiedAt).toISOString(), locale),
          })}
          <span aria-hidden className="mx-1.5">
            ·
          </span>
          <span className="font-mono">{formatBytes(file.size)}</span>
          <span aria-hidden className="mx-1.5">
            ·
          </span>
          {t(HELD_FILE_STANDING_I18N_KEYS[heldFileStanding(file)])}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={working} onClick={onPutBack}>
          {t("modal.file_manager.held.put_back")}
        </Button>
        <Button variant="danger" size="sm" disabled={working} onClick={onDelete}>
          {t("action.delete")}
        </Button>
      </div>
    </li>
  );
}
