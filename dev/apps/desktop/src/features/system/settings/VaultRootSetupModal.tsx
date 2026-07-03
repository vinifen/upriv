import { useCallback, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useAppSettingsService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { initializeVaultRootPath, validateVaultRootPath } from "@/platform/tauri/vaultRoot";

interface VaultRootSetupModalProps {
  open: boolean;
  onConfigured: () => void;
}

export function VaultRootSetupModal({ open, onConfigured }: VaultRootSetupModalProps) {
  const { t } = useTranslation();
  const appSettingsService = useAppSettingsService();
  const { settings, patchSettings } = useAppSettingsContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Folder the user picked that is not yet an Upriv root (offer to initialize). */
  const [pendingInitPath, setPendingInitPath] = useState<string | null>(null);

  const applyRoot = useCallback(
    async (path: string) => {
      await patchSettings({
        app: {
          ...settings.app,
          auto_detect_vault_root: false,
          upriv_root_path: path,
        },
      });
      onConfigured();
    },
    [onConfigured, patchSettings, settings.app],
  );

  const handleChooseFolder = useCallback(() => {
    setBusy(true);
    setError(null);
    setPendingInitPath(null);
    void appSettingsService
      .pickVaultRootFolder()
      .then(async (picked) => {
        const path = picked?.trim();
        if (!path) return;

        if (await validateVaultRootPath(path)) {
          await applyRoot(path);
          return;
        }
        setPendingInitPath(path);
      })
      .catch(() => {
        setError(t("error.settings_save_failed"));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [appSettingsService, applyRoot, t]);

  const handleInitializeHere = useCallback(() => {
    if (!pendingInitPath) return;
    setBusy(true);
    setError(null);
    void initializeVaultRootPath(pendingInitPath)
      .then(async (root) => {
        await applyRoot(root);
        setPendingInitPath(null);
      })
      .catch(() => {
        setError(t("error.vault_root_init_failed"));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [applyRoot, pendingInitPath, t]);

  if (!open) return null;

  const footer = (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
      {pendingInitPath ? (
        <>
          <Button
            variant="ghost"
            size="md"
            disabled={busy}
            onClick={() => {
              setPendingInitPath(null);
              setError(null);
            }}
          >
            {t("action.back")}
          </Button>
          <Button variant="primary" size="md" disabled={busy} onClick={handleInitializeHere}>
            {t("modal.vault_root_setup.create_here")}
          </Button>
        </>
      ) : (
        <Button variant="primary" size="md" disabled={busy} onClick={handleChooseFolder}>
          {t("modal.vault_root_setup.choose_folder")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_setup.title")}
      onClose={() => undefined}
      panelClassName="max-w-lg"
      footer={footer}
    >
      <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
        {pendingInitPath ? (
          <>
            <p>{t("modal.vault_root_setup.not_a_root")}</p>
            <p className="break-all rounded-md bg-surface-container px-3 py-2 font-mono text-xs text-on-surface">
              {pendingInitPath}
            </p>
            <p>{t("modal.vault_root_setup.create_here_hint")}</p>
          </>
        ) : (
          <>
            <p>{t("modal.vault_root_setup.body")}</p>
            <p>{t("modal.vault_root_setup.hint")}</p>
          </>
        )}
        {error ? (
          <p
            className="rounded-md bg-error-container/10 px-3 py-2 text-sm text-on-error-container"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
