import { useCallback, useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass } from "@/components/settings";
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

type Mode = "auto" | "fixed";
type Step = "choose" | "repair" | "confirm_delete";

/**
 * Blocking first-run when no vault-root is found.
 * Choose mode with radios (same pattern as Settings), then Continue:
 * - Auto: create default `.upriv/` next to the app.
 * - Fixed: initialize if needed + write active `.upriv-root` alias.
 * Incomplete `.upriv/` → rename (recommended) or delete (+ confirm).
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
  const rootModeGroup = useId();
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode>("auto");
  const [repairPolicy, setRepairPolicy] = useState<IncompleteReplacePolicy>("rename");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repairPolicyGroup = useId();

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setMode("auto");
    setRepairPolicy("rename");
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
    async (rootPath: string, nextMode: Mode) => {
      const saved = await patchSettings(
        {
          app: {
            auto_detect_vault_root: nextMode === "auto",
            upriv_root_path: nextMode === "fixed" ? rootPath : "",
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
      .catch((caught) => {
        if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          // Nearby incomplete should normally be handled by VaultRootRepairModal;
          // surface repair for this edge case.
          setPathInput(nearbyAnchor);
          setMode("auto");
          setStep("repair");
          setError(null);
          return;
        }
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
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
        else if (!pathInput.trim()) {
          setPathInput(appSettingsService.getDefaultRootPathSuggestion());
        }
      })
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_pick")));
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
        .catch((caught) => {
          if (
            !options?.replaceIncomplete &&
            isRpcError(caught) &&
            caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE
          ) {
            setMode("fixed");
            setStep("repair");
            setError(null);
            return;
          }
          setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [finish, settings.ui.locale, t, vaultRoot],
  );

  const handleContinue = useCallback(() => {
    if (mode === "auto") {
      handleCreateNearby();
      return;
    }
    const path = pathInput.trim();
    if (!path) {
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }
    runSetupAtPath(path);
  }, [handleCreateNearby, mode, pathInput, runSetupAtPath, t]);

  const applyRepair = useCallback(
    (policy: IncompleteReplacePolicy) => {
      const path = pathInput.trim();
      if (!path) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }
      if (mode === "auto") {
        // Nearby incomplete edge: replace at anchor via setupNearby policy.
        setBusy(true);
        setError(null);
        void vaultRoot
          .setupNearby({
            replaceIncomplete: true,
            replacePolicy: policy,
            locale: settings.ui.locale,
          })
          .then(async ({ rootPath }) => {
            setStep("choose");
            await finish(rootPath, "auto");
          })
          .catch((caught) => {
            setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
          })
          .finally(() => setBusy(false));
        return;
      }
      runSetupAtPath(path, { replaceIncomplete: true, replacePolicy: policy });
    },
    [finish, mode, pathInput, runSetupAtPath, settings.ui.locale, t, vaultRoot],
  );

  const handleRepairContinue = useCallback(() => {
    if (repairPolicy === "delete") {
      setError(null);
      setStep("confirm_delete");
      return;
    }
    applyRepair("rename");
  }, [applyRepair, repairPolicy]);

  if (!open) return null;

  const continueDisabled =
    busy || (mode === "fixed" && !pathInput.trim() && step === "choose");

  const footer =
    step === "choose" ? (
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          disabled={continueDisabled}
          className="w-full sm:w-auto"
          onClick={handleContinue}
        >
          {t("action.continue")}
        </Button>
      </div>
    ) : step === "repair" ? (
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
          variant="primary"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={handleRepairContinue}
        >
          {t("action.continue")}
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
        step === "choose" || step === "repair" ? (
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
            <div
              role="radiogroup"
              aria-label={t("modal.app_settings.field.upriv_root_mode")}
              className="grid gap-2"
            >
              <PolicyRadioOption
                groupName={rootModeGroup}
                value="auto"
                checked={mode === "auto"}
                title={t("modal.app_settings.option.upriv_root.auto")}
                description={t("modal.app_settings.option.upriv_root.auto_desc")}
                badge="default"
                onSelect={() => {
                  setMode("auto");
                  setError(null);
                }}
                footer={
                  mode === "auto" ? (
                    <p className="break-all rounded-md bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                      {nearbyAnchor}
                    </p>
                  ) : null
                }
              />
              <PolicyRadioOption
                groupName={rootModeGroup}
                value="fixed"
                checked={mode === "fixed"}
                title={t("modal.app_settings.option.upriv_root.fixed")}
                description={t("modal.app_settings.option.upriv_root.fixed_desc", {
                  file: VAULT_ROOT_ALIAS_FILE,
                })}
                onSelect={() => {
                  setMode("fixed");
                  setError(null);
                }}
                footer={
                  mode === "fixed" ? (
                    <div className="space-y-2">
                      <p className="text-xs leading-relaxed text-on-surface-variant">
                        {t("modal.vault_root_setup.alias_notice", {
                          file: VAULT_ROOT_ALIAS_FILE,
                          aliasPath,
                        })}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <input
                          type="text"
                          readOnly
                          value={pathInput}
                          placeholder={t("modal.vault_root_setup.path_placeholder")}
                          aria-invalid={error ? true : undefined}
                          className={[
                            settingsControlClass,
                            "font-mono text-xs sm:min-w-0 sm:flex-1",
                          ].join(" ")}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          className="w-full shrink-0 sm:w-auto"
                          disabled={busy}
                          onClick={handlePickFolder}
                        >
                          {t("modal.app_settings.action.choose_folder")}
                        </Button>
                      </div>
                    </div>
                  ) : null
                }
              />
            </div>
          </>
        ) : step === "repair" ? (
          <>
            <p>
              {t(
                mode === "fixed"
                  ? "modal.vault_root_repair.body_fixed"
                  : "modal.vault_root_repair.body",
              )}
            </p>
            <p className="break-all rounded-md bg-surface-container px-3 py-2 font-mono text-xs text-on-surface">
              {pathInput.trim()}
            </p>
            <div
              role="radiogroup"
              aria-label={t("modal.vault_root_repair.title")}
              className="grid gap-2"
            >
              <PolicyRadioOption
                groupName={repairPolicyGroup}
                value="rename"
                checked={repairPolicy === "rename"}
                title={t("modal.vault_root_repair.option_rename")}
                description={t("modal.vault_root_repair.rename_hint")}
                badge="default"
                onSelect={() => {
                  setRepairPolicy("rename");
                  setError(null);
                }}
              />
              <PolicyRadioOption
                groupName={repairPolicyGroup}
                value="delete"
                checked={repairPolicy === "delete"}
                title={t("modal.vault_root_repair.option_delete")}
                description={t("modal.vault_root_repair.delete_hint")}
                tone="less-secure"
                onSelect={() => {
                  setRepairPolicy("delete");
                  setError(null);
                }}
              />
            </div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              {t("modal.vault_root_repair.inspect_hint")}
            </p>
          </>
        ) : (
          <p role="alert">
            {t(
              mode === "fixed"
                ? "modal.vault_root_repair.confirm_delete_body_fixed"
                : "modal.vault_root_repair.confirm_delete_body",
            )}
          </p>
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
