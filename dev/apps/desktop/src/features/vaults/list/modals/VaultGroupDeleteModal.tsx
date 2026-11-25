import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useOperationLimit } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import type { VaultGroup } from "@upriv/shared";

interface VaultGroupDeleteModalProps {
  group: VaultGroup | null;
  open: boolean;
  onClose: () => void;
  onDelete: () => Promise<void> | void;
  onBusyTimeout?: () => void;
}

/**
 * Delete group, from the last entry of the group's Settings menu, as Delete
 * vault is from a vault's: the group goes, its vaults stay.
 */
export function VaultGroupDeleteModal({
  group,
  open,
  onClose,
  onDelete,
  onBusyTimeout,
}: VaultGroupDeleteModalProps) {
  const { t } = useTranslation();
  const busyGen = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = useOperationLimit(busy);

  useEffect(() => {
    if (open) return;
    busyGen.current += 1;
    setBusy(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!limit.timedOut || !busy) return;
    busyGen.current += 1;
    onBusyTimeout?.();
    setBusy(false);
    setError(t("error.operation_timed_out"));
  }, [limit.timedOut, busy, onBusyTimeout, t]);

  if (!open || !group) return null;

  const remove = async () => {
    if (busy) return;
    const generation = ++busyGen.current;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      if (generation !== busyGen.current) return;
      onClose();
    } catch (caught) {
      if (generation !== busyGen.current) return;
      setError(t(desktopErrorI18nKey(caught)));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("vault.group.settings.delete")}
      titleIcon="trash"
      contextTitle={group.displayName}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      panelClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" size="md" disabled={busy} onClick={() => void remove()}>
            {t("vault.group.settings.delete")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-on-surface-variant">{t("vault.group.settings.delete_help")}</p>
        <p className="text-sm text-on-surface-variant">
          {t("vault.group.settings.delete_confirm")}
        </p>
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
      </div>
    </Modal>
  );
}
