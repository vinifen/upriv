import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
  type IncompleteReplacePolicy,
  type LocaleId,
} from "@upriv/shared";
import { useAppSettingsService, useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

interface VaultRootSetupModalProps {
  open: boolean;
  nearbyAnchor: string;
  aliasPath: string;
  onConfigured: () => void;
}

type Step = "choose" | "other_path" | "repair" | "confirm_delete";

/**
 * Blocking first-run when no vault-root is found.
 * - Nearby: create default `.upriv/` next to the app (auto-detect).
 * - Other path: initialize if needed + write active `.upriv-root` alias.
 * - Incomplete `.upriv/` at chosen path → rename (recommended) or delete (+ confirm).
 */
export function VaultRootSetupModal({
  open,
  nearbyAnchor,
  aliasPath,
  onConfigured,
}: VaultRootSetupModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const appSettingsService = useAppSettingsService();
  const { settings, patchSettings } = useAppSettingsContext();
  const [step, setStep] = useState<Step>("choose");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setPathInput("");
    setBusy(false);
    setError(null);
  }, [open]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const finish = useCallback(
    async (rootPath: string, mode: "auto" | "fixed") => {
      const saved = await patchSettings(
        {
          app: {
            auto_detect_vault_root: mode === "auto",
            upriv_root_path: mode === "fixed" ? rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (!saved) {
        throw new Error("settings_save_failed");
      }
      onConfigured();
    },
    [onConfigured, patchSettings],
  );

  const handleCreateNearby = useCallback(() => {
    setBusy(true);
    setError(null);
    void vaultRoot
      .setupNearby({ locale: settings.ui.locale })
      .then(async ({ rootPath }) => {
        await finish(rootPath, "auto");
      })
      .catch((error) => {
        if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          // Nearby incomplete should normally be handled by VaultRootRepairModal;
          // surface repair for this edge case.
          setPathInput(nearbyAnchor);
          setStep("repair");
          setError(null);
          return;
        }
        setError(t(desktopErrorI18nKey(error, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [finish, nearbyAnchor, settings.ui.locale, t, vaultRoot]);

  const handlePickFolder = useCallback(() => {
    setBusy(true);
    setError(null);
    void vaultRoot
      .pickFolder(pathInput.trim() || null, t("modal.vault_root_setup.pick_folder_title"))
      .then((picked) => {
        if (picked) setPathInput(picked);
        else if (!pathInput) {
          setPathInput(appSettingsService.getDefaultRootPathSuggestion());
        }
      })
      .catch((error) => {
        setError(t(desktopErrorI18nKey(error, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [appSettingsService, pathInput, t, vaultRoot]);

  const runSetupAtPath = useCallback(
    (
      path: string,
      options?: { replaceIncomplete?: boolean; replacePolicy?: IncompleteReplacePolicy },
    ) => {
      setBusy(true);
      setError(null);
      void vaultRoot
        .setupAtPath(path, { ...options, locale: settings.ui.locale })
        .then(async ({ rootPath }) => {
          setStep("choose");
          await finish(rootPath, "fixed");
        })
        .catch((error) => {
          if (
            !options?.replaceIncomplete &&
            isRpcError(error) &&
            error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE
          ) {
            setStep("repair");
            setError(null);
            return;
          }
          setError(t(desktopErrorI18nKey(error, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [finish, settings.ui.locale, t, vaultRoot],
  );

  const handleConfirmOtherPath = useCallback(() => {
    const path = pathInput.trim();
    if (!path) {
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }
    runSetupAtPath(path);
  }, [pathInput, runSetupAtPath, t]);

  const applyRepair = useCallback(
    (policy: IncompleteReplacePolicy) => {
      const path = pathInput.trim();
      if (!path) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }
      runSetupAtPath(path, { replaceIncomplete: true, replacePolicy: policy });
    },
    [pathInput, runSetupAtPath, t],
  );

  if (!open) return null;

  const footer =
    step === "choose" ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={() => {
            setStep("other_path");
            setError(null);
            setPathInput("");
          }}
        >
          {t("modal.vault_root_setup.choose_other")}
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={handleCreateNearby}
        >
          {t("modal.vault_root_setup.create_nearby")}
        </Button>
      </div>
    ) : step === "other_path" ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="ghost"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={() => {
            setStep("choose");
            setError(null);
          }}
        >
          {t("action.back")}
        </Button>
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={handlePickFolder}
        >
          {t("modal.vault_root_setup.browse")}
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={busy || !pathInput.trim()}
          className="w-full sm:w-auto"
          onClick={handleConfirmOtherPath}
        >
          {t("modal.vault_root_setup.use_this_folder")}
        </Button>
      </div>
    ) : step === "repair" ? (
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="md"
          disabled={busy}
          className="w-full"
          onClick={() => applyRepair("rename")}
        >
          {t("modal.vault_root_repair.action_rename_recommended")}
        </Button>
        <Button
          variant="danger"
          size="md"
          disabled={busy}
          className="w-full"
          onClick={() => {
            setError(null);
            setStep("confirm_delete");
          }}
        >
          {t("modal.vault_root_repair.action_delete")}
        </Button>
        <Button
          variant="ghost"
          size="md"
          disabled={busy}
          className="w-full"
          onClick={() => {
            setStep("other_path");
            setError(null);
          }}
        >
          {t("action.back")}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="ghost"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={() => {
            setStep("repair");
            setError(null);
          }}
        >
          {t("action.back")}
        </Button>
        <Button
          variant="danger"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={() => applyRepair("delete")}
        >
          {t("modal.vault_root_repair.confirm_delete_action")}
        </Button>
      </div>
    );

  const title =
    step === "confirm_delete"
      ? t("modal.vault_root_repair.confirm_delete_title")
      : step === "repair"
        ? t("modal.vault_root_repair.title")
        : t("modal.vault_root_setup.title");

  return (
    <Modal
      open={open}
      title={title}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      footer={footer}
      rootClassName="z-[200]"
      headerActions={
        step === "choose" || step === "other_path" || step === "repair" ? (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">{t("modal.app_settings.field.locale")}</span>
            <select
              value={settings.ui.locale}
              disabled={busy}
              aria-label={t("modal.app_settings.field.locale")}
              onChange={(event) => handleLocaleChange(event.target.value as LocaleId)}
              className="h-9 max-w-[9.5rem] rounded-lg border border-transparent bg-surface-container-highest px-2 text-xs text-on-surface outline-none focus:border-[var(--accent)] disabled:opacity-60 sm:h-10 sm:max-w-[11rem] sm:text-sm"
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {t(`modal.app_settings.option.locale.${locale}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
        {step === "choose" ? (
          <>
            <p>{t("modal.vault_root_setup.body")}</p>
            <p className="break-all rounded-md bg-surface-container px-3 py-2 font-mono text-xs text-on-surface">
              {nearbyAnchor}
            </p>
            <p>{t("modal.vault_root_setup.create_nearby_hint")}</p>
            <p>{t("modal.vault_root_setup.choose_other_hint")}</p>
          </>
        ) : step === "other_path" ? (
          <>
            <p>{t("modal.vault_root_setup.other_path_body")}</p>
            <p>
              {t("modal.vault_root_setup.alias_notice", {
                file: VAULT_ROOT_ALIAS_FILE,
                aliasPath,
              })}
            </p>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface">
                {t("modal.vault_root_setup.path_label")}
              </span>
              <input
                type="text"
                value={pathInput}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setPathInput(event.target.value);
                  setError(null);
                }}
                placeholder={t("modal.vault_root_setup.path_placeholder")}
                className="w-full rounded-lg border border-transparent bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-[var(--accent)]"
              />
            </label>
          </>
        ) : step === "repair" ? (
          <>
            <p>{t("modal.vault_root_repair.body")}</p>
            <p className="break-all rounded-md bg-surface-container px-3 py-2 font-mono text-xs text-on-surface">
              {pathInput.trim()}
            </p>
            <p>{t("modal.vault_root_repair.rename_hint")}</p>
            <p>{t("modal.vault_root_repair.delete_hint")}</p>
            <p>{t("modal.vault_root_repair.inspect_hint")}</p>
          </>
        ) : (
          <p role="alert">{t("modal.vault_root_repair.confirm_delete_body")}</p>
        )}
        {busy ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t("modal.vault_root_setup.busy")}
          </p>
        ) : null}
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
