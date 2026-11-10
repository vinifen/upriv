import { useEffect, useId, useState } from "react";
import { Button, ElapsedTime, JobStopButton, Modal, PasswordInput } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import {
  lifecycleBusyLabelKey,
  offersVaultRebuild,
  requireVaultErrorI18nKey,
  resolveVaultPasswordHint,
  vaultRowWorkClock,
  VAULT_ERROR_CODES,
  type VaultListItem,
  type VaultRowWork,
} from "@upriv/shared";
import { useVaultLifecycleService } from "@/platform/services";
import { VaultPasswordHintCallout } from "./VaultPasswordHintCallout";
import { SettingsField } from "@/components/settings";

const lifecyclePasswordClass =
  "w-full rounded-lg border border-transparent bg-surface-container-highest px-2.5 py-2 text-sm text-on-surface outline-none focus:border-[var(--accent)] sm:px-3 sm:py-2.5";

interface VaultLifecycleModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  pipelineStep?: number;
  /** The open in flight for this vault: its clock and its Stop. */
  work?: VaultRowWork | null;
  verifyErrorKey?: I18nKey | null;
  /** Prefill after a failed attempt — the field, not the session RAM map. */
  initialPassword?: string;
  onClose: () => void;
  onConfirm: (password: string) => void;
  onStop: () => void;
  /**
   * The unlock found the vault's index lost: rebuild it with the password
   * typed. The vault list runs the rebuild, so the window closes.
   */
  onRebuild: (password: string) => void;
}

/**
 * Unlock password dialog. Lock starts the close without a dialog. When the
 * password opens the vault but its index is lost, the dialog offers the
 * rebuild from the vault's own data.
 */
export function VaultLifecycleModal({
  vault,
  open,
  submitting = false,
  pipelineStep = 0,
  work = null,
  verifyErrorKey = null,
  initialPassword,
  onClose,
  onConfirm,
  onStop,
  onRebuild,
}: VaultLifecycleModalProps) {
  const { t } = useTranslation();
  const lifecycleService = useVaultLifecycleService();
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      return;
    }
    setPassword(initialPassword ?? "");
    setError(null);
  }, [open, vault?.id, initialPassword]);

  useEffect(() => {
    if (!verifyErrorKey) return;
    setError(t(verifyErrorKey));
  }, [t, verifyErrorKey]);

  if (!open || !vault) return null;

  const handleConfirm = () => {
    if (!lifecycleService.validateLifecyclePassword(password)) {
      setError(t(requireVaultErrorI18nKey(VAULT_ERROR_CODES.WRONG_PASSWORD)));
      return;
    }
    setError(null);
    onConfirm(password);
  };

  const canSubmit = !submitting && lifecycleService.validateLifecyclePassword(password);
  const passwordHint = resolveVaultPasswordHint(vault);
  // Shown for the password that found the index lost; editing it hides the offer.
  const rebuildOffered = !submitting && error !== null && offersVaultRebuild(verifyErrorKey);

  return (
    <Modal
      open={open}
      title={t("unlock.title")}
      titleIcon="lock-open"
      contextTitle={vault.displayName}
      onClose={onClose}
      dismissible
      panelClassName="max-w-md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {submitting ? (
            <>
              <span className="text-sm text-on-surface-variant" role="status">
                {work?.startedAt != null
                  ? t(lifecycleBusyLabelKey("unlock", pipelineStep))
                  : t("vault.status.queued")}
              </span>
              {work?.stop ? (
                <JobStopButton
                  size="sm"
                  stoppingSince={work.stoppingSince}
                  stoppable={work.stop !== "final"}
                  onStop={onStop}
                />
              ) : null}
            </>
          ) : rebuildOffered ? (
            <Button variant="primary" size="sm" onClick={() => onRebuild(password)}>
              {t("unlock.rebuild")}
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={handleConfirm}>
              {t("unlock.submit")}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 px-0.5 pb-1">
        <div className="space-y-2">
          <SettingsField label={t("unlock.password")} htmlFor={passwordId}>
            <PasswordInput
              id={passwordId}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSubmit) handleConfirm();
              }}
              autoComplete="current-password"
              autoFocus
              inputClassName={lifecyclePasswordClass}
            />
          </SettingsField>
          {passwordHint ? <VaultPasswordHintCallout hint={passwordHint} /> : null}
        </div>
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
        {rebuildOffered ? (
          <p className="text-sm text-on-surface-variant">{t("unlock.rebuild_help")}</p>
        ) : null}
        {submitting && work?.stop !== "stopping" ? (
          <ElapsedTime startedAt={vaultRowWorkClock(work)} />
        ) : null}
      </div>
    </Modal>
  );
}
