import { IMPORT_BLOCK_REASON_I18N, type ImportBlockedReport } from "@upriv/shared";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface ImportBlockedModalProps {
  /** `null` while no import has items to name. */
  report: ImportBlockedReport | null;
  /** Import again, without the items that cannot be imported. */
  onLeaveOut: () => void;
  /** Closed: a refused import stays cancelled. */
  onClose: () => void;
  /** Stacks the window above the surface that opened it. */
  rootClassName?: string;
}

/**
 * The items an import could not take, each named with why, from the chosen
 * file or folder; a long list scrolls, and a line counts the ones not named.
 * Refused, nothing was imported: the person cancels or imports without them,
 * and when the chosen item itself is one, only Close is left. Left out, the
 * rest is in the vault, and the window only reports them.
 */
export function ImportBlockedModal({
  report,
  onLeaveOut,
  onClose,
  rootClassName,
}: ImportBlockedModalProps) {
  const { t } = useTranslation();
  const blocked = report?.blocked;
  const more = blocked ? blocked.count - blocked.items.length : 0;
  const leftOut = report?.stage === "left_out";
  const closeOnly = leftOut || (blocked?.whole ?? false);
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
      panelClassName="max-w-xl"
      rootClassName={rootClassName}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {closeOnly ? (
            <Button variant="primary" size="sm" onClick={onClose}>
              {t("action.close")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t("action.cancel")}
              </Button>
              <Button variant="primary" size="sm" onClick={onLeaveOut}>
                {t("modal.import_blocked.leave_out")}
              </Button>
            </>
          )}
        </div>
      }
    >
      {blocked ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">{t(body)}</p>
          <p className="text-sm font-medium text-on-surface">{count}</p>
          <ul
            aria-label={title}
            className="max-h-72 divide-y divide-outline-variant/40 overflow-y-auto rounded-xl bg-surface-container"
          >
            {blocked.items.map((item, index) => (
              <li key={`${index}:${item.path}`} className="px-3 py-2">
                <span className="block break-all font-mono text-xs text-on-surface">
                  {item.path}
                </span>
                <span className="mt-0.5 block text-xs text-on-surface-variant">
                  {t(IMPORT_BLOCK_REASON_I18N[item.reason])}
                </span>
              </li>
            ))}
          </ul>
          {more > 0 ? (
            <p className="text-xs text-on-surface-variant">
              {more === 1
                ? t("modal.import_blocked.more_one")
                : t("modal.import_blocked.more", { count: String(more) })}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
