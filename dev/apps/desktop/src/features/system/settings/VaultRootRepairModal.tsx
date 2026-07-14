import { useCallback, useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { SUPPORTED_LOCALES, type IncompleteReplacePolicy, type LocaleId } from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

interface VaultRootRepairModalProps {
  open: boolean;
  /** Folder that contains the broken `.upriv/` (nearby anchor or fixed path). */
  targetPath: string;
  /**
   * `nearby` → setupNearby + switch to auto.
   * `fixed` → setupAtPath + keep fixed alias at `targetPath`.
   */
  mode: "nearby" | "fixed";
  onRepaired: () => void;
}

type Step = "choose" | "confirm_delete";
type PolicyChoice = IncompleteReplacePolicy;

/**
 * Blocking when a chosen vault-root has incomplete/corrupt `.upriv/`.
 * Radios + Continue: rename (recommended) or delete (+ confirm).
 */
export function VaultRootRepairModal({
  open,
  targetPath,
  mode,
  onRepaired,
}: VaultRootRepairModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const { settings, patchSettings } = useAppSettingsContext();
  const policyGroup = useId();
  const [step, setStep] = useState<Step>("choose");
  const [policy, setPolicy] = useState<PolicyChoice>("rename");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setPolicy("rename");
    setBusy(false);
    setError(null);
  }, [open, targetPath, mode]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const applyRepair = useCallback(
    (nextPolicy: IncompleteReplacePolicy) => {
      setBusy(true);
      setError(null);
      const run =
        mode === "nearby"
          ? vaultRoot.setupNearby({
              replaceIncomplete: true,
              replacePolicy: nextPolicy,
              locale: settings.ui.locale,
            })
          : vaultRoot.setupAtPath(targetPath, {
              replaceIncomplete: true,
              replacePolicy: nextPolicy,
              locale: settings.ui.locale,
            });

      void run
        .then(async ({ rootPath }) => {
          const saved = await patchSettings(
            {
              app: {
                auto_detect_vault_root: mode === "nearby",
                upriv_root_path: mode === "fixed" ? rootPath : "",
              },
            },
            { vaultRootAlreadyApplied: true },
          );
          if (!saved) {
            throw new Error("settings_save_failed");
          }
          setStep("choose");
          onRepaired();
        })
        .catch((err) => {
          setError(t(desktopErrorI18nKey(err, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [mode, onRepaired, patchSettings, settings.ui.locale, t, targetPath, vaultRoot],
  );

  const handleContinue = useCallback(() => {
    if (policy === "delete") {
      setError(null);
      setStep("confirm_delete");
      return;
    }
    applyRepair("rename");
  }, [applyRepair, policy]);

  if (!open) return null;

  const footer =
    step === "choose" ? (
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          disabled={busy}
          className="w-full sm:w-auto"
          onClick={handleContinue}
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
            setStep("choose");
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

  return (
    <Modal
      open={open}
      title={t(
        step === "confirm_delete"
          ? "modal.vault_root_repair.confirm_delete_title"
          : "modal.vault_root_repair.title",
      )}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      footer={footer}
      rootClassName="z-[200]"
      headerActions={
        step === "choose" ? (
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
            <p>
              {t(
                mode === "fixed"
                  ? "modal.vault_root_repair.body_fixed"
                  : "modal.vault_root_repair.body",
              )}
            </p>
            <p className="break-all rounded-md bg-surface-container px-3 py-2 font-mono text-xs text-on-surface">
              {targetPath}
            </p>
            <div
              role="radiogroup"
              aria-label={t("modal.vault_root_repair.title")}
              className="grid gap-2"
            >
              <PolicyRadioOption
                groupName={policyGroup}
                value="rename"
                checked={policy === "rename"}
                title={t("modal.vault_root_repair.option_rename")}
                description={t("modal.vault_root_repair.rename_hint")}
                badge="default"
                onSelect={() => {
                  setPolicy("rename");
                  setError(null);
                }}
              />
              <PolicyRadioOption
                groupName={policyGroup}
                value="delete"
                checked={policy === "delete"}
                title={t("modal.vault_root_repair.option_delete")}
                description={t("modal.vault_root_repair.delete_hint")}
                tone="less-secure"
                onSelect={() => {
                  setPolicy("delete");
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
