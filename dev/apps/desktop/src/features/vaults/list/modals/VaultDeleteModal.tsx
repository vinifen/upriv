import { useId, useState } from "react";
import {
  VAULT_DELETE_HOLD_I18N_KEY,
  VAULT_SETTINGS_MENU_ICON,
  isVaultDeleteUnfinished,
  jobStepCopy,
  vaultDeleteHold,
  type VaultListItem,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import type { VaultDeleteJob } from "@upriv/shared/react";
import { settingsControlClass } from "@/components/settings";
import { Button, JobProgressBar, Modal, SwitchRow } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useVaultService } from "@/platform/services";

interface VaultDeleteModalProps {
  /** The vault whose window is open; `null` keeps the window closed. */
  vault: VaultListItem | null;
  pipelineListStatus: VaultPipelineListStatus;
  /** The delete in flight, of whichever vault; the list owns it. */
  job: VaultDeleteJob | null;
  onClose: () => void;
  /** Start the delete, or Continue one that did not finish. False when it cannot start. */
  onDelete: (vaultId: string, outsideBackups: boolean) => boolean;
}

/**
 * The Delete vault window, opened from the row's Settings menu. Each opening
 * starts with nothing typed and the outside backups kept.
 */
export function VaultDeleteModal({ vault, ...props }: VaultDeleteModalProps) {
  if (!vault) return null;
  return <VaultDeleteWindow key={vault.id} vault={vault} {...props} />;
}

/**
 * What a delete removes, the vault ID to type, and the outside-backups
 * switch. While the delete runs, its step, bar, and elapsed time in their
 * place: it goes on when the window closes, and Delete now in More options
 * ends it early. One that did not finish offers Continue.
 */
function VaultDeleteWindow({
  vault,
  pipelineListStatus,
  job,
  onClose,
  onDelete,
}: Omit<VaultDeleteModalProps, "vault"> & { vault: VaultListItem }) {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const confirmId = useId();
  const [confirm, setConfirm] = useState("");
  const [removeOutsideBackups, setRemoveOutsideBackups] = useState(false);

  const running = job !== null && job.vaultId === vault.id ? job : null;
  const unfinished = isVaultDeleteUnfinished(vault, pipelineListStatus);
  const hold = unfinished ? null : vaultDeleteHold(vault, pipelineListStatus);
  const canSubmit =
    vaultService.canDeleteVault && (unfinished || (hold === null && confirm.trim() === vault.id));

  const submit = () => {
    if (!canSubmit) return;
    if (onDelete(vault.id, removeOutsideBackups)) setConfirm("");
  };

  return (
    <Modal
      open
      title={t("modal.delete_vault.title")}
      titleIcon={VAULT_SETTINGS_MENU_ICON.delete}
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        running ? undefined : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              {t("action.cancel")}
            </Button>
            <Button variant="danger" size="md" disabled={!canSubmit} onClick={submit}>
              {t(unfinished ? "action.continue_delete" : "modal.delete_vault.submit")}
            </Button>
          </div>
        )
      }
    >
      {running ? (
        <div className="space-y-2">
          <JobProgressBar
            progress={running.progress}
            startedAt={running.startedAt}
            label={t("modal.delete_vault.title")}
            copy={jobStepCopy(running.progress, "job.step.overwriting")}
          />
          <p className="text-xs leading-relaxed text-on-surface-variant">
            {t("modal.delete_vault.running")}
          </p>
        </div>
      ) : unfinished ? (
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("modal.delete_vault.unfinished")}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("modal.delete_vault.help")}
          </p>
          {hold ? (
            <p className="text-sm text-on-surface-variant">{t(VAULT_DELETE_HOLD_I18N_KEY[hold])}</p>
          ) : null}
          <label htmlFor={confirmId} className="block text-sm text-on-surface-variant">
            {t("modal.delete_vault.confirm")}
          </label>
          <p className="font-mono text-xs text-on-surface-variant/80">{vault.id}</p>
          <input
            id={confirmId}
            type="text"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={hold !== null}
            className={settingsControlClass}
          />
          {vault.outsideBackups === true ? (
            <SwitchRow
              checked={removeOutsideBackups}
              disabled={hold !== null}
              onChange={setRemoveOutsideBackups}
              label={t("modal.delete_vault.outside_backups")}
              hint={t("modal.delete_vault.outside_backups_help")}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
