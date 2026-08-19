import { useEffect, useMemo, useRef, useState } from "react";
import { settingsControlClass } from "@/components/settings";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { LOADING_BUDGET_MS, type VaultGroup, type VaultListItem } from "@upriv/shared";

interface VaultGroupAssignmentModalProps {
  vault: VaultListItem | null;
  groups: VaultGroup[];
  open: boolean;
  onClose: () => void;
  onAssign: (vaultId: string, groupId: string | null) => Promise<void> | void;
}

/**
 * Per-vault group assignment — open from the vault row ⋮ menu.
 * New groups are created from System settings or Vault settings (Save).
 */
export function VaultGroupAssignmentModal({
  vault,
  groups,
  open,
  onClose,
  onAssign,
}: VaultGroupAssignmentModalProps) {
  const { t } = useTranslation();
  const busyGen = useRef(0);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budget = useLoadingBudget(busy, LOADING_BUDGET_MS.default);

  const currentGroup = useMemo(
    () =>
      vault
        ? (groups.find((g) => g.groupedVaults.includes(vault.id)) ?? null)
        : null,
    [groups, vault],
  );

  useEffect(() => {
    if (!open) {
      busyGen.current += 1;
      setBusy(false);
      setError(null);
      return;
    }
    setSelectedGroupId(currentGroup?.id ?? "");
    setError(null);
  }, [open, currentGroup?.id]);

  useEffect(() => {
    if (!budget.timedOut || !busy) return;
    busyGen.current += 1;
    setBusy(false);
    setError(t("error.operation_timed_out"));
  }, [budget.timedOut, busy, t]);

  if (!vault) return null;

  const selectionUnchanged = selectedGroupId === (currentGroup?.id ?? "");
  const canSubmit = !busy && !selectionUnchanged;

  const close = () => {
    if (busy) return;
    onClose();
  };

  const run = async (work: () => Promise<void> | void) => {
    const generation = ++busyGen.current;
    setBusy(true);
    setError(null);
    try {
      await work();
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
      title={t("vault.group.assignment.modal_title")}
      onClose={close}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={close} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!canSubmit}
            onClick={() =>
              void run(async () => {
                const next = selectedGroupId.trim() ? selectedGroupId : null;
                await onAssign(vault.id, next);
              })
            }
          >
            {t("vault.group.assignment.apply")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">
          {t("vault.group.assignment.for_vault", { name: vault.displayName })}
        </p>

        <label className="block space-y-2">
          <span className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
            {t("vault.group.assignment.section")}
          </span>
          <select
            className={settingsControlClass}
            value={selectedGroupId}
            onChange={(event) => {
              setSelectedGroupId(event.target.value);
              setError(null);
            }}
            disabled={busy}
          >
            <option value="">{t("vault.group.assignment.ungrouped")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.displayName}
              </option>
            ))}
          </select>
        </label>

        {currentGroup ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              void run(() => onAssign(vault.id, null));
            }}
          >
            {t("vault.group.assignment.remove")}
          </Button>
        ) : null}

        {budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
      </div>
    </Modal>
  );
}
