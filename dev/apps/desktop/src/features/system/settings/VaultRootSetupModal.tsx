import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  type VaultRootMode,
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

type Step = "choose" | "repair" | "confirm_delete";

/**
 * Blocking first-run when no vault-root is found.
 * Choose mode with radios (same pattern as Settings), then Continue:
 * - Nearby: create default `.upriv/` next to the app.
 * - Custom: initialize if needed + write active `.upriv-root` alias.
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
  const [mode, setMode] = useState<VaultRootMode>("nearby");
  const [repairPolicy, setRepairPolicy] = useState<IncompleteReplacePolicy>("rename");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repairPolicyGroup = useId();
  const submitLock = useRef(false);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setMode("nearby");
    setRepairPolicy("rename");
    setPathInput("");
    setBusy(false);
    setError(null);
    submitLock.current = false;
    diskApplied.current = null;
  }, [open]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const finish = useCallback(
    async (rootPath: string, nextMode: VaultRootMode) => {
      diskApplied.current = { rootPath, mode: nextMode };
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: nextMode,
            upriv_root_path: nextMode === "custom" ? rootPath : "",
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
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      if (diskApplied.current?.mode === "nearby") {
        await finish(diskApplied.current.rootPath, "nearby");
        return;
      }
      const { rootPath } = await vaultRoot.setupNearby({ locale: settings.ui.locale });
      await finish(rootPath, "nearby");
    })()
      .catch((caught) => {
        if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          // Nearby incomplete should normally be handled by VaultRootRepairModal;
          // surface repair for this edge case.
          setPathInput(nearbyAnchor);
          setMode("nearby");
          setStep("repair");
          setError(null);
          return;
        }
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        submitLock.current = false;
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
      if (submitLock.current) return;
      submitLock.current = true;
      setBusy(true);
      setError(null);
      void (async () => {
        if (diskApplied.current?.mode === "custom" && !options?.replaceIncomplete) {
          setStep("choose");
          await finish(diskApplied.current.rootPath, "custom");
          return;
        }
        const { rootPath } = await vaultRoot.setupAtPath(path, {
          ...options,
          locale: settings.ui.locale,
        });
        setStep("choose");
        await finish(rootPath, "custom");
      })()
        .catch((caught) => {
          if (
            !options?.replaceIncomplete &&
            isRpcError(caught) &&
            caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE
          ) {
            setMode("custom");
            setStep("repair");
            setError(null);
            return;
          }
          setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          submitLock.current = false;
          setBusy(false);
        });
    },
    [finish, settings.ui.locale, t, vaultRoot],
  );

  const handleContinue = useCallback(() => {
    if (mode === "nearby") {
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
      if (mode === "nearby") {
        if (submitLock.current) return;
        submitLock.current = true;
        // Nearby incomplete edge: replace at anchor via setupNearby policy.
        setBusy(true);
        setError(null);
        void (async () => {
          if (diskApplied.current?.mode === "nearby") {
            setStep("choose");
            await finish(diskApplied.current.rootPath, "nearby");
            return;
          }
          const { rootPath } = await vaultRoot.setupNearby({
            replaceIncomplete: true,
            replacePolicy: policy,
            locale: settings.ui.locale,
          });
          setStep("choose");
          await finish(rootPath, "nearby");
        })()
          .catch((caught) => {
            setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
          })
          .finally(() => {
            submitLock.current = false;
            setBusy(false);
          });
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

  const continueDisabled = busy || (mode === "custom" && !pathInput.trim() && step === "choose");

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
                value="nearby"
                checked={mode === "nearby"}
                title={t("modal.app_settings.option.upriv_root.nearby")}
                description={t("modal.app_settings.option.upriv_root.nearby_desc")}
                badge="default"
                onSelect={() => {
                  setMode("nearby");
                  setError(null);
                }}
                footer={
                  mode === "nearby" ? (
                    <p className="break-all rounded-md bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                      {nearbyAnchor}
                    </p>
                  ) : null
                }
              />
              <PolicyRadioOption
                groupName={rootModeGroup}
                value="custom"
                checked={mode === "custom"}
                title={t("modal.app_settings.option.upriv_root.custom")}
                description={t("modal.app_settings.option.upriv_root.custom_desc", {
                  file: VAULT_ROOT_ALIAS_FILE,
                })}
                onSelect={() => {
                  setMode("custom");
                  setError(null);
                }}
                footer={
                  mode === "custom" ? (
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
                mode === "custom"
                  ? "modal.vault_root_repair.body_custom"
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
              mode === "custom"
                ? "modal.vault_root_repair.confirm_delete_body_custom"
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
