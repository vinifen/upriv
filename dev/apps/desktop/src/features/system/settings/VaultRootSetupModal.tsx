import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
  type AppDistribution,
  type IncompleteReplacePolicy,
  type LocaleId,
  type VaultRootMode,
  type VaultRootPresentationState,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

/** Trim + strip trailing separators for diskApplied path equality. */
function samePathKey(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/[/\\]+$/g, "");
  return norm(a) === norm(b);
}

interface VaultRootSetupModalProps {
  open: boolean;
  presentation: VaultRootPresentationState;
  /** From `needs_setup` — drives portable/installed/dev copy. */
  distribution: AppDistribution;
  onConfigured: () => void;
}

type Step = "choose" | "repair" | "confirm_delete";

/**
 * Blocking first-run when no vault-root is found.
 * Choose mode with radios (same pattern as Settings), then Continue:
 * - Default data folder: create default `.upriv/` at the default_root anchor (app home).
 * - Custom: initialize if needed + write active `.upriv-root` alias.
 * Incomplete `.upriv/` → rename (recommended) or delete (+ confirm).
 */
export function VaultRootSetupModal({
  open,
  presentation,
  distribution,
  onConfigured,
}: VaultRootSetupModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const defaultRootAnchor = presentation.defaultRootAnchor;
  const aliasPath = presentation.aliasPath;
  const { settings, patchSettings } = useAppSettingsContext();
  const rootModeGroup = useId();
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<VaultRootMode>("default_root");
  const [repairPolicy, setRepairPolicy] = useState<IncompleteReplacePolicy>("rename");
  const [pathInput, setPathInput] = useState("");
  /** Path from `.upriv-root` (active or inactive) — same prefill as Settings custom_root mode. */
  const [aliasRememberedPath, setAliasRememberedPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repairPolicyGroup = useId();
  const submitLock = useRef(false);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);
  const aliasLoadGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setMode("default_root");
    setRepairPolicy("rename");
    setPathInput("");
    setAliasRememberedPath("");
    setBusy(false);
    setError(null);
    submitLock.current = false;
    diskApplied.current = null;

    const gen = ++aliasLoadGen.current;
    const fromSettings = settings.app.upriv_root_path.trim();
    if (fromSettings) {
      setAliasRememberedPath(fromSettings);
    }
    void vaultRoot
      .readAlias()
      .then((alias) => {
        if (gen !== aliasLoadGen.current) return;
        const path = alias?.path.trim() || "";
        if (path) setAliasRememberedPath(path);
      })
      .catch(() => {
        // Keep settings path if any.
      });
    // Prefill only when the modal opens — not on every settings tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open edge
  }, [open, distribution, defaultRootAnchor]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      // Before a writable vault-root exists, Context keeps this in memory only.
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
            upriv_root_path: nextMode === "custom_root" ? rootPath : "",
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

  const handleCreateDefaultRoot = useCallback(() => {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      if (diskApplied.current?.mode === "default_root") {
        await finish(diskApplied.current.rootPath, "default_root");
        return;
      }
      const { rootPath } = await vaultRoot.setupDefaultRoot({ locale: settings.ui.locale });
      await finish(rootPath, "default_root");
    })()
      .catch((caught) => {
        if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          // Default-root incomplete should normally be handled by VaultRootRepairModal;
          // surface repair for this edge case.
          setPathInput(defaultRootAnchor);
          setMode("default_root");
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
  }, [finish, defaultRootAnchor, settings.ui.locale, t, vaultRoot]);

  const handlePickFolder = useCallback(() => {
    setBusy(true);
    setError(null);
    void (async () => {
      const remembered = pathInput.trim() || aliasRememberedPath.trim();
      const suggested =
        remembered ||
        (await vaultRoot.suggestedCustomRootPath().catch(() => ""));
      const picked = await vaultRoot.pickFolder(
        suggested || null,
        t("modal.vault_root_setup.pick_folder_title"),
      );
      // Only fill when the user confirmed a folder — cancel must not inject a suggestion.
      if (picked) setPathInput(picked);
    })()
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [aliasRememberedPath, pathInput, t, vaultRoot]);

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
        const applied = diskApplied.current;
        // Never reuse a prior disk apply for a different folder (C1).
        if (
          applied?.mode === "custom_root" &&
          !options?.replaceIncomplete &&
          samePathKey(applied.rootPath, path)
        ) {
          setStep("choose");
          await finish(applied.rootPath, "custom_root");
          return;
        }
        if (applied && !samePathKey(applied.rootPath, path)) {
          diskApplied.current = null;
        }
        const { rootPath } = await vaultRoot.setupAtPath(path, {
          ...options,
          locale: settings.ui.locale,
        });
        setStep("choose");
        await finish(rootPath, "custom_root");
      })()
        .catch((caught) => {
          if (
            !options?.replaceIncomplete &&
            isRpcError(caught) &&
            caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE
          ) {
            setMode("custom_root");
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
    if (mode === "default_root") {
      handleCreateDefaultRoot();
      return;
    }
    const path = pathInput.trim();
    if (!path) {
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }
    runSetupAtPath(path);
  }, [handleCreateDefaultRoot, mode, pathInput, runSetupAtPath, t]);

  const applyRepair = useCallback(
    (policy: IncompleteReplacePolicy) => {
      const path = pathInput.trim();
      if (!path) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }
      if (mode === "default_root") {
        if (submitLock.current) return;
        submitLock.current = true;
        // Default-root incomplete edge: replace at anchor via setupDefaultRoot policy.
        setBusy(true);
        setError(null);
        void (async () => {
          if (diskApplied.current?.mode === "default_root") {
            setStep("choose");
            await finish(diskApplied.current.rootPath, "default_root");
            return;
          }
          const { rootPath } = await vaultRoot.setupDefaultRoot({
            replaceIncomplete: true,
            replacePolicy: policy,
            locale: settings.ui.locale,
          });
          setStep("choose");
          await finish(rootPath, "default_root");
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

  const setupBodyKey =
    distribution === "installed"
      ? "modal.vault_root_setup.body_installed"
      : distribution === "dev"
        ? "modal.vault_root_setup.body_dev"
        : "modal.vault_root_setup.body_portable";

  const defaultRootTitleKey =
    distribution === "installed"
      ? "modal.app_settings.option.upriv_root.default_root_installed"
      : "modal.app_settings.option.upriv_root.default_root";

  const defaultRootDescKey =
    distribution === "installed"
      ? "modal.app_settings.option.upriv_root.default_root_desc_installed"
      : "modal.app_settings.option.upriv_root.default_root_desc";

  if (!open) return null;

  const continueDisabled =
    busy || (mode === "custom_root" && !pathInput.trim() && step === "choose");

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
            <p>{t(setupBodyKey)}</p>
            <div
              role="radiogroup"
              aria-label={t("modal.app_settings.field.upriv_root_mode")}
              className="grid gap-2"
            >
              <PolicyRadioOption
                groupName={rootModeGroup}
                value="default_root"
                checked={mode === "default_root"}
                title={t(defaultRootTitleKey)}
                description={t(defaultRootDescKey)}
                badge="default"
                onSelect={() => {
                  setMode("default_root");
                  setError(null);
                }}
                footer={
                  mode === "default_root" ? (
                    <p className="break-all rounded-md bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                      {defaultRootAnchor}
                    </p>
                  ) : null
                }
              />
              <PolicyRadioOption
                groupName={rootModeGroup}
                value="custom_root"
                checked={mode === "custom_root"}
                title={t("modal.app_settings.option.upriv_root.custom_root")}
                description={t("modal.app_settings.option.upriv_root.custom_root_desc", {
                  file: VAULT_ROOT_ALIAS_FILE,
                })}
                onSelect={() => {
                  setMode("custom_root");
                  setError(null);
                  setPathInput((current) => {
                    const trimmed = current.trim();
                    if (trimmed) return trimmed;
                    return aliasRememberedPath.trim();
                  });
                }}
                footer={
                  mode === "custom_root" ? (
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
                            "cursor-not-allowed opacity-90 font-mono text-xs sm:min-w-0 sm:flex-1",
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
                mode === "custom_root"
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
              mode === "custom_root"
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
