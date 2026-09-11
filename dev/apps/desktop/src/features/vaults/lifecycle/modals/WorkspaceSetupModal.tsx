import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PolicyRadioOption, SettingsField, settingsControlClass } from "@/components/settings";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useVaultRootService } from "@/platform/services";
import {
  LOADING_BUDGET_MS,
  suggestedDefaultWorkspacePath,
  validateWorkspaceGlobalPath,
  workspacePathIssueI18nKey,
} from "@upriv/shared";

type WorkspaceSetupMode = "default" | "custom";

interface WorkspaceSetupModalProps {
  open: boolean;
  /** Absolute vault-root path used to build the Default radio suggestion. */
  vaultRootPath: string;
  onCancel: () => void;
  /** Called after `[workspace].path` is saved successfully. */
  onConfigured: () => void;
}

/**
 * First-open prompt when app `[workspace].path` is unset and the vault uses
 * mount `"default"`. Radios: Default = `<vault-root>/workspace`, Custom = pick.
 */
export function WorkspaceSetupModal({
  open,
  vaultRootPath,
  onCancel,
  onConfigured,
}: WorkspaceSetupModalProps) {
  const { t } = useTranslation();
  const { patchSettings } = useAppSettingsContext();
  const vaultRoot = useVaultRootService();
  const groupId = useId();
  const pathId = useId();
  const suggested = suggestedDefaultWorkspacePath(vaultRootPath);
  const hasDefaultSuggestion = Boolean(suggested);
  const busyGen = useRef(0);
  const [mode, setMode] = useState<WorkspaceSetupMode>("default");
  const [customPath, setCustomPath] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const openedRef = useRef(false);
  const budget = useLoadingBudget(busy, LOADING_BUDGET_MS.settingsSave);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      busyGen.current += 1;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    busyGen.current += 1;
    setMode(hasDefaultSuggestion ? "default" : "custom");
    setCustomPath("");
    setConfirmOpen(false);
    setBusy(false);
    setError(null);
    submitLock.current = false;
  }, [open, hasDefaultSuggestion]);

  useEffect(() => {
    if (!budget.timedOut || !busy) return;
    busyGen.current += 1;
    submitLock.current = false;
    setBusy(false);
    setError(t("error.operation_timed_out"));
  }, [budget.timedOut, busy, t]);

  const chosenPath = mode === "default" ? suggested : customPath.trim();
  const pathIssue =
    mode === "custom"
      ? !customPath.trim()
        ? ("empty" as const)
        : validateWorkspaceGlobalPath(customPath, vaultRootPath)
      : !suggested
        ? ("empty" as const)
        : validateWorkspaceGlobalPath(suggested, vaultRootPath);
  const blocked = busy || pathIssue != null || !chosenPath;

  const requestContinue = useCallback(() => {
    if (blocked || confirmOpen) return;
    setConfirmOpen(true);
  }, [blocked, confirmOpen]);

  const commit = useCallback(() => {
    if (blocked || submitLock.current || !chosenPath) return;
    const generation = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // `patchSettings` returns false on persist failure (no throw) — same as mobile.
        const ok = await patchSettings({ workspace: { path: chosenPath } });
        if (generation !== busyGen.current) return;
        if (!ok) {
          setError(t("error.settings_save_failed"));
          setConfirmOpen(false);
          submitLock.current = false;
          setBusy(false);
          return;
        }
        setConfirmOpen(false);
        onConfigured();
        submitLock.current = false;
        setBusy(false);
      } catch (caught) {
        if (generation !== busyGen.current) return;
        setError(t(desktopErrorI18nKey(caught, "error.settings_save_failed")));
        setConfirmOpen(false);
        submitLock.current = false;
        setBusy(false);
      }
    })();
  }, [blocked, chosenPath, onConfigured, patchSettings, t]);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        if (confirmOpen) {
          setConfirmOpen(false);
          return;
        }
        onCancel();
      }}
      title={t("modal.workspace.setup.title")}
      titleIcon="folder"
      panelClassName="max-w-lg"
      footer={
        <div className="flex flex-col gap-3">
          {error ? (
            <p className="text-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : confirmOpen ? (
            <p className="text-sm text-on-surface-variant">
              {t("modal.workspace.setup.continue_confirm")}
            </p>
          ) : null}
          {budget.visible ? (
            <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
            <Button
              variant="primary"
              size="md"
              disabled={confirmOpen ? busy : blocked}
              onClick={confirmOpen ? commit : requestContinue}
            >
              {confirmOpen
                ? t("modal.workspace.setup.continue_confirm_action")
                : t("modal.workspace.setup.continue")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={busy}
              onClick={() => {
                if (confirmOpen) {
                  setConfirmOpen(false);
                  return;
                }
                onCancel();
              }}
            >
              {t("modal.settings.save_cancel")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("modal.workspace.setup.intro")}
        </p>
        <div role="radiogroup" aria-label={t("modal.workspace.setup.title")} className="grid gap-2">
          {hasDefaultSuggestion ? (
            <PolicyRadioOption
              groupName={groupId}
              value="default"
              checked={mode === "default"}
              title={t("modal.workspace.setup.option.default")}
              description={t("modal.workspace.setup.option.default_desc", {
                path: suggested || "—",
              })}
              badge="default"
              onSelect={() => {
                setMode("default");
                setConfirmOpen(false);
                setError(null);
              }}
              footer={
                mode === "default" && pathIssue ? (
                  <p className="mt-1 text-xs text-on-error-container" role="alert">
                    {t(workspacePathIssueI18nKey(pathIssue))}
                  </p>
                ) : null
              }
            />
          ) : null}
          <PolicyRadioOption
            groupName={groupId}
            value="custom"
            checked={mode === "custom"}
            title={t("modal.workspace.setup.option.custom")}
            description={t("modal.workspace.setup.option.custom_desc")}
            onSelect={() => {
              setMode("custom");
              setConfirmOpen(false);
              setError(null);
            }}
            footer={
              mode === "custom" ? (
                <SettingsField
                  label={t("modal.app_settings.field.workspace.path")}
                  htmlFor={pathId}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      id={pathId}
                      type="text"
                      value={customPath}
                      placeholder={t("modal.app_settings.field.workspace.path_placeholder")}
                      onChange={(e) => {
                        setCustomPath(e.target.value);
                        setConfirmOpen(false);
                        setError(null);
                      }}
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
                      onClick={() => {
                        void (async () => {
                          try {
                            const picked = await vaultRoot.pickFolder(
                              customPath.trim() || suggested || null,
                              t("modal.app_settings.action.pick_workspace_folder"),
                            );
                            if (!picked?.trim()) return;
                            setCustomPath(picked.trim());
                            setConfirmOpen(false);
                            setError(null);
                          } catch (caught) {
                            setError(
                              t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_pick")),
                            );
                          }
                        })();
                      }}
                    >
                      {t("modal.app_settings.action.pick_workspace_folder")}
                    </Button>
                  </div>
                  {pathIssue ? (
                    <p className="mt-1 text-xs text-on-error-container" role="alert">
                      {t(workspacePathIssueI18nKey(pathIssue))}
                    </p>
                  ) : null}
                </SettingsField>
              ) : null
            }
          />
        </div>
      </div>
    </Modal>
  );
}
