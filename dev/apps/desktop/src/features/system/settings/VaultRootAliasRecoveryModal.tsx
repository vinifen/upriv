import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  RpcError,
  isRpcError,
  type LocaleId,
  type VaultRootMode,
  type VaultRootPresentationState,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";
import type { VaultRootDiskStatus } from "./vaultRootSettingsIntent";

/** Trim + strip trailing separators for diskApplied path equality. */
function samePathKey(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/[/\\]+$/g, "");
  return norm(a) === norm(b);
}

interface VaultRootAliasRecoveryModalProps {
  open: boolean;
  presentation: VaultRootPresentationState;
  onRecovered: () => void;
  /** Default-root incomplete while switching to `default_root` mode — hand off to Gate repair. */
  onDefaultRootIncomplete: (defaultRootAnchor: string) => void;
  /** Custom-path incomplete — hand off to Gate repair. */
  onCustomIncomplete: (path: string) => void;
}

function isIncompleteError(error: unknown): boolean {
  if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) return true;
  if (error instanceof Error) {
    return (
      error.message === VAULT_ROOT_ERROR_CODES.INCOMPLETE ||
      error.message.startsWith(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`) ||
      error.message.includes(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`)
    );
  }
  return false;
}

/**
 * Blocking when custom alias / path is invalid or missing.
 * Radios + Continue (same pattern as first-run setup and Data folder).
 */
export function VaultRootAliasRecoveryModal({
  open,
  presentation,
  onRecovered,
  onDefaultRootIncomplete,
  onCustomIncomplete,
}: VaultRootAliasRecoveryModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const { settings, patchSettings } = useAppSettingsContext();
  const rootModeGroup = useId();
  const [mode, setMode] = useState<VaultRootMode>("default_root");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [customDisk, setCustomDisk] = useState<VaultRootDiskStatus>("needs_folder");
  const submitLock = useRef(false);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);
  const customCheckGen = useRef(0);
  const rememberedPath = presentation.rememberedAliasTarget ?? "";
  const [defaultRootAnchor, setDefaultRootAnchor] = useState(() =>
    presentation.defaultRootAnchor.trim(),
  );

  useEffect(() => {
    if (!open) return;
    setMode(presentation.mode === "custom_root" ? "custom_root" : "default_root");
    setPathInput(rememberedPath.trim());
    setBusy(false);
    setError(null);
    setConfirmOpen(false);
    setCustomDisk(rememberedPath.trim() ? "checking" : "needs_folder");
    submitLock.current = false;
    diskApplied.current = null;
    setDefaultRootAnchor(presentation.defaultRootAnchor.trim());

    let cancelled = false;
    void vaultRoot
      .defaultRootStatus()
      .then((result) => {
        if (!cancelled && result.defaultRootAnchor.trim()) {
          setDefaultRootAnchor(result.defaultRootAnchor.trim());
        }
      })
      .catch(() => {
        // Keep presentation anchor if any.
      });
    return () => {
      cancelled = true;
    };
  }, [open, rememberedPath, presentation.mode, presentation.defaultRootAnchor, vaultRoot]);

  // Invalidate diskApplied when the user picks a different custom path (C1).
  useEffect(() => {
    const applied = diskApplied.current;
    if (!applied || applied.mode !== "custom_root") return;
    if (!samePathKey(pathInput, applied.rootPath)) {
      diskApplied.current = null;
    }
  }, [pathInput]);

  // Live inspect for custom path (parity with Setup / Data folder).
  useEffect(() => {
    if (!open || mode !== "custom_root") {
      setCustomDisk("ready");
      return;
    }
    const path = pathInput.trim();
    const gen = ++customCheckGen.current;
    if (!path) {
      setCustomDisk("needs_folder");
      return;
    }
    setCustomDisk("checking");
    void vaultRoot
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== customCheckGen.current) return;
        if (result.status === "incomplete") setCustomDisk("incomplete");
        else if (result.status === "unreadable") setCustomDisk("unreadable");
        else if (result.status === "absent") setCustomDisk("will_create");
        else setCustomDisk("ready");
      })
      .catch(() => {
        if (gen !== customCheckGen.current) return;
        setCustomDisk("unreadable");
      });
  }, [open, mode, pathInput, vaultRoot]);

  // Changing the draft dismisses footer confirm (two-step Continue pattern).
  useEffect(() => {
    setConfirmOpen(false);
  }, [mode, pathInput, customDisk]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      // Before a writable vault-root exists, Context keeps this in memory only.
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const handlePickFolder = useCallback(() => {
    setBusy(true);
    setError(null);
    void (async () => {
      const remembered = pathInput.trim() || rememberedPath.trim();
      const suggested = remembered || (await vaultRoot.suggestedCustomRootPath().catch(() => ""));
      const picked = await vaultRoot.pickFolder(
        suggested || null,
        t("modal.vault_root_setup.pick_folder_title"),
      );
      if (picked) setPathInput(picked);
    })()
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => setBusy(false));
  }, [pathInput, rememberedPath, t, vaultRoot]);

  const commitContinue = useCallback(() => {
    // UI primary = Continue (Alias Recovery gate — not Apply).
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      if (mode === "default_root") {
        if (!diskApplied.current || diskApplied.current.mode !== "default_root") {
          const defaultRoot = await vaultRoot.defaultRootStatus();
          if (defaultRoot.status === "incomplete") {
            onDefaultRootIncomplete(defaultRoot.defaultRootAnchor);
            return;
          }
          if (defaultRoot.status === "unreadable") {
            throw new RpcError(
              VAULT_ROOT_ERROR_CODES.IO_ERROR,
              "default_root .upriv is unreadable",
            );
          }
          try {
            const { rootPath } = await vaultRoot.setupDefaultRoot({
              bootstrap: { locale: settings.ui.locale },
            });
            diskApplied.current = { rootPath, mode: "default_root" };
          } catch (caught) {
            if (isIncompleteError(caught)) {
              onDefaultRootIncomplete(defaultRoot.defaultRootAnchor);
              return;
            }
            throw caught;
          }
        }
        const saved = await patchSettings(
          {
            app: {
              vault_root_mode: "default_root",
              upriv_root_path: "",
            },
          },
          { vaultRootAlreadyApplied: true },
        );
        if (!saved) throw new Error("settings_save_failed");
        onRecovered();
        return;
      }

      const path = pathInput.trim();
      const applied = diskApplied.current;
      const canReuseCustom =
        applied?.mode === "custom_root" && path && samePathKey(applied.rootPath, path);

      if (!path && !canReuseCustom) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }

      if (!canReuseCustom) {
        diskApplied.current = null;
        try {
          const inspected = await vaultRoot.inspectAtPath(path);
          if (inspected.status === "incomplete") {
            onCustomIncomplete(path);
            return;
          }
        } catch (caught) {
          if (isIncompleteError(caught)) {
            onCustomIncomplete(path);
            return;
          }
          // Inspect I/O — still try setup; Incomplete from setup is handled below.
        }
        try {
          const { rootPath } = await vaultRoot.setupAtPath(path, {
            bootstrap: { locale: settings.ui.locale },
          });
          diskApplied.current = { rootPath, mode: "custom_root" };
          const saved = await patchSettings(
            {
              app: {
                vault_root_mode: "custom_root",
                upriv_root_path: rootPath,
              },
            },
            { vaultRootAlreadyApplied: true },
          );
          if (!saved) throw new Error("settings_save_failed");
          onRecovered();
          return;
        } catch (caught) {
          if (isIncompleteError(caught)) {
            onCustomIncomplete(path);
            return;
          }
          throw caught;
        }
      }

      // Disk already applied for this path — retry settings save with canonical rootPath.
      const reused = diskApplied.current!;
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: reused.mode,
            upriv_root_path: reused.mode === "custom_root" ? reused.rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (!saved) throw new Error("settings_save_failed");
      onRecovered();
    })()
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        submitLock.current = false;
        setBusy(false);
      });
  }, [
    mode,
    onCustomIncomplete,
    onDefaultRootIncomplete,
    onRecovered,
    patchSettings,
    pathInput,
    settings.ui.locale,
    t,
    vaultRoot,
  ]);

  const blocked =
    (mode === "custom_root" && !pathInput.trim()) ||
    (mode === "custom_root" &&
      (customDisk === "checking" || customDisk === "unreadable" || customDisk === "needs_folder"));

  // UI primary = Continue
  const requestContinue = useCallback(() => {
    if (busy || blocked || confirmOpen) return;
    setConfirmOpen(true);
  }, [blocked, busy, confirmOpen]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_setup.title")}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      rootClassName="z-[200]"
      headerActions={
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
      }
      footer={
        <VaultRootConfirmFooter
          busy={busy}
          blocked={blocked}
          confirmOpen={confirmOpen}
          noteKeys={undefined}
          onRequestPrimary={requestContinue}
          onConfirmPrimary={commitContinue}
          onCancelConfirm={() => setConfirmOpen(false)}
        />
      }
    >
      <div
        className="space-y-3 text-sm leading-relaxed text-on-surface-variant"
        onPointerDown={() => {
          if (confirmOpen) setConfirmOpen(false);
        }}
      >
        <p role="alert">{t("modal.vault_root_setup.error_alias_invalid")}</p>
        {rememberedPath.trim() ? (
          <p className="font-mono text-xs break-all text-on-surface">
            {t("modal.vault_root_setup.alias_invalid_path", {
              path: rememberedPath.trim(),
              file: VAULT_ROOT_ALIAS_FILE,
            })}
          </p>
        ) : null}
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.upriv_root_mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="default_root"
            checked={mode === "default_root"}
            title={t("modal.app_settings.option.upriv_root.default_root")}
            description={t("modal.vault_root_setup.recovery_default_root_desc")}
            badge="default"
            onSelect={() => {
              setMode("default_root");
              setError(null);
            }}
            footer={
              mode === "default_root" ? (
                defaultRootAnchor ? (
                  <p className="break-all rounded-md bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                    {defaultRootAnchor}
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                    {t("modal.app_settings.field.upriv_root_loading")}
                  </p>
                )
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
              if (!pathInput.trim() && rememberedPath.trim()) {
                setPathInput(rememberedPath.trim());
              }
            }}
            footer={
              mode === "custom_root" ? (
                <div className="space-y-2">
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
                  {customDisk === "checking" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </p>
                  ) : null}
                  {customDisk === "will_create" ? (
                    <p
                      className="rounded-md bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface"
                      role="status"
                    >
                      {t("modal.vault_root_gate.continue_confirm_note.create")}
                    </p>
                  ) : null}
                  {customDisk === "incomplete" ? (
                    <p
                      className="rounded-md bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface"
                      role="status"
                    >
                      {t("modal.app_settings.continue_confirm_custom_incomplete", {
                        path: pathInput.trim() || "…",
                      })}
                    </p>
                  ) : null}
                  {customDisk === "unreadable" ? (
                    <p
                      className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                      role="alert"
                    >
                      {t("modal.vault_root_setup.error_io")}
                    </p>
                  ) : null}
                </div>
              ) : null
            }
          />
        </div>
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
