import { type ReactNode, memo, useId } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button, IconButton, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useRevealWhen } from "@/hooks/useRevealWhen";
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
import type { FileManagerApi } from "../hooks/useVaultFileManager";

const checkboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/40 disabled:opacity-40";

/**
 * The data a vault set aside because no file of its tree names it, laid out
 * like the Backups window. A file another copy of the vault names can be put
 * back or deleted; a piece nothing names can only be deleted. Items are
 * chosen one by one or all at once, and a delete asks below the list first.
 */
export function HeldFilesDialog({ fm, open }: { fm: FileManagerApi; open: boolean }) {
  const { t } = useTranslation();
  const { held } = fm;
  const summary = held.summary;
  const review = useHeldReview(held, (paths) =>
    fm.showToast(
      paths.length === 1
        ? t("modal.file_manager.held.put_back_toast", { path: paths[0] })
        : t("modal.file_manager.held.put_back_many_toast", { count: String(paths.length) }),
    ),
  );
  const confirmRef = useRevealWhen<HTMLDivElement>(review.asking !== null);
  const asking = review.asking !== null;
  /** A single item has nothing to choose among: its row's buttons cover it. */
  const selectable = review.items.length > 1;
  const chosen = [...review.selected];

  return (
    <Modal
      open={open && held.open}
      title={t("modal.file_manager.held.title")}
      titleIcon="archive"
      onClose={() => held.show(false)}
      panelClassName="max-w-2xl"
      rootClassName="z-[120]"
      bodyScroll={false}
    >
      {summary ? (
        <>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            {t("modal.file_manager.held.intro")}
          </p>
          {selectable && !asking ? (
            <HeldToolbar
              review={review}
              onPutBack={() => review.putBack(review.selectedFiles)}
              onDelete={() => review.askDelete(chosen)}
            />
          ) : null}
          <div className="modal-scroll-pane min-h-0 flex-1 space-y-5 overflow-y-auto pr-0.5">
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
                    variant="danger"
                    size="sm"
                    className="shrink-0"
                    disabled={
                      asking || summary.pieces.some((piece) => held.working.has(piece.name))
                    }
                    onClick={() => review.askDelete(summary.pieces.map((piece) => piece.name))}
                  >
                    {t("modal.file_manager.held.pieces_delete")}
                  </Button>
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
          </div>
          {review.asking ? (
            <div
              ref={confirmRef}
              className="mt-4 space-y-3 rounded-xl bg-surface-container px-4 py-4"
            >
              <DeleteQuestion asking={review.asking} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={review.cancelDelete}>
                  {t("action.cancel")}
                </Button>
                <Button variant="danger" size="sm" onClick={review.confirmDelete}>
                  {t("action.delete")}
                </Button>
              </div>
            </div>
          ) : null}
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
  const selectAllId = useId();
  const count = review.selected.size;
  return (
    <div className="mb-2 flex min-h-14 flex-wrap items-center gap-2 pl-4 pr-2 sm:flex-nowrap sm:pr-3">
      <label
        htmlFor={selectAllId}
        className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-3"
      >
        <input
          id={selectAllId}
          type="checkbox"
          checked={review.allSelected}
          ref={(node) => {
            if (node) node.indeterminate = count > 0 && !review.allSelected;
          }}
          onChange={review.toggleAll}
          className={checkboxClass}
        />
        <span className="text-sm text-on-surface-variant">
          {t("modal.file_manager.held.select_all")}
        </span>
      </label>
      {count > 0 ? (
        <div className="flex shrink-0 items-center gap-1 sm:ml-auto">
          <span className="pr-1 text-xs tabular-nums text-on-surface-variant">
            {t("modal.file_manager.held.selected_count", { count: String(count) })}
          </span>
          {review.selectedFiles.length > 0 ? (
            <IconButton
              label={t("modal.file_manager.held.put_back_selected")}
              size="row"
              variant="row-action"
              className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
              onClick={onPutBack}
            >
              <Icon name="history" size={18} />
            </IconButton>
          ) : null}
          <IconButton
            label={t("modal.file_manager.held.delete_selected")}
            size="row"
            variant="row-action"
            className="-mr-1 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container"
            onClick={onDelete}
          >
            <Icon name="trash" size={18} />
          </IconButton>
        </div>
      ) : null}
    </div>
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
  return (
    <section className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-on-surface">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{help}</p>
        </div>
        {action}
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
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
  const checkboxId = useId();
  const { file } = item;
  const icon: IconName = file ? "file" : "warning";
  const date = (ms: number) => formatIsoDate(new Date(ms).toISOString(), locale);
  return (
    <li
      className={[
        "rounded-xl border border-transparent bg-surface-container transition-colors",
        checked ? "border-accent/40" : "hover:bg-surface-container-high/80",
      ].join(" ")}
    >
      <div
        className={[
          "flex min-h-14 items-center gap-3 py-3 pl-4 pr-2 sm:pr-3",
          disabled ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        {selectable ? (
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle(item.name)}
            className={checkboxClass}
          />
        ) : null}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
          <Icon name={icon} size={18} />
        </div>
        <label
          htmlFor={selectable ? checkboxId : undefined}
          className={[
            "min-w-0 flex-1 select-none",
            selectable && !disabled ? "cursor-pointer" : "cursor-default",
          ].join(" ")}
        >
          <p className="truncate font-mono text-xs text-on-surface sm:text-sm" title={file?.path}>
            {file ? fileBaseName(file.path) : t("modal.file_manager.held.piece")}
          </p>
          {file ? (
            <p
              className="mt-0.5 truncate text-xs text-on-surface-variant"
              title={getParentPath(file.path)}
            >
              {getParentPath(file.path)}
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-on-surface-variant">
            {file
              ? t("modal.file_manager.held.changed", { date: date(file.modifiedAt) })
              : t("modal.file_manager.held.set_aside", { date: date(item.heldAt) })}
            <span aria-hidden className="mx-1.5">
              ·
            </span>
            <span className="font-mono">{formatBytes(file?.size ?? item.size)}</span>
            {file ? (
              <>
                <span aria-hidden className="mx-1.5">
                  ·
                </span>
                {t(HELD_FILE_STANDING_I18N_KEYS[heldFileStanding(file)])}
              </>
            ) : null}
          </p>
        </label>
        <div className="flex shrink-0 items-center justify-end gap-0.5">
          {file ? (
            <IconButton
              label={t("modal.file_manager.held.put_back")}
              size="row"
              variant="row-action"
              disabled={disabled}
              className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
              onClick={() => onPutBack([item.name])}
            >
              <Icon name="history" size={18} />
            </IconButton>
          ) : null}
          <IconButton
            label={t("action.delete")}
            size="row"
            variant="row-action"
            disabled={disabled}
            className="-mr-1 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container"
            onClick={() => onDelete([item.name])}
          >
            <Icon name="trash" size={18} />
          </IconButton>
        </div>
      </div>
    </li>
  );
});

function DeleteQuestion({ asking }: { asking: HeldDeleteAsk }) {
  const { t } = useTranslation();
  const count = asking.names.length;
  const size = formatBytes(asking.bytes);
  const question = asking.onlyPath
    ? t("modal.file_manager.held.delete_question_file", { name: fileBaseName(asking.onlyPath) })
    : asking.files === 0
      ? t("modal.file_manager.held.delete_question_pieces", { count, size })
      : t("modal.file_manager.held.delete_question_many", { count: String(count), size });
  return (
    <div className="text-sm" aria-live="polite">
      <p className="text-on-surface-variant">{question}</p>
      <p className="mt-1 text-on-surface-variant">
        {t("modal.file_manager.held.delete_irreversible")}
      </p>
    </div>
  );
}
