import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  SUPPORTED_LOCALES,
  type IncompleteReplacePolicy,
  type LocaleId,
  type VaultRootMode,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { VaultRootIncompleteReplacePanel } from "./VaultRootIncompleteReplacePanel";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";
import {
  confirmNotesForReplacePolicy,
  vaultRootGateFromState,
  type VaultRootDiskStatus,
} from "./vaultRootSettingsIntent";

interface VaultRootRepairModalProps {
  open: boolean;
  /** Folder that contains the broken `.upriv/` (default_root anchor or custom path). */
  targetPath: string;
  /**
   * `default_root` → setupDefaultRoot + switch to default-root mode.
   * `custom_root` → setupAtPath + keep active alias at `targetPath`.
   */
  mode: VaultRootMode;
  onRepaired: () => void;
}

/** Top-level choice: fix current folder, or expand “choose another folder” (Settings-style). */
type PolicyChoice = IncompleteReplacePolicy | "choose_other";

type DiskApplied = {
  rootPath: string;
  source: "current" | "other";
  mode: VaultRootMode;
  /** Path that was mutated (targetPath or otherPath). */
  path: string;
  /** Policy used for that disk mutation (null = create / open without replace). */
  replacePolicy: IncompleteReplacePolicy | null;
};

function samePathKey(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/[/\\]+$/g, "");
  return norm(a) === norm(b);
}

/**
 * Blocking when a chosen vault-root has incomplete/corrupt `.upriv/`.
 *
 * Same rich-field pattern as Data folder / Setup: rename / delete on the current
 * path, or expand “choose another folder” with picker + inspect. Incomplete
 * other folders show rename/delete **inside** that expansion. Destructive
 * delete is warned via the red footer note only — no second confirm step.
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
  const otherRepairGroup = useId();
  const [policy, setPolicy] = useState<PolicyChoice>("rename");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherPath, setOtherPath] = useState("");
  const [otherDisk, setOtherDisk] = useState<VaultRootDiskStatus>("needs_folder");
  const [otherReplacePolicy, setOtherReplacePolicy] = useState<IncompleteReplacePolicy | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const diskApplied = useRef<DiskApplied | null>(null);
  const otherCheckGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    setPolicy("rename");
    setBusy(false);
    setError(null);
    submitLock.current = false;
    busyGen.current += 1;
    diskApplied.current = null;
    setOtherPath("");
    setOtherDisk("needs_folder");
    setOtherReplacePolicy(null);
    setConfirmOpen(false);
  }, [open, targetPath, mode]);

  // Drop cached disk apply when the user changes what they intend to apply.
  useEffect(() => {
    diskApplied.current = null;
  }, [policy, otherPath, otherReplacePolicy]);

  // Changing the draft dismisses footer confirm (Settings Save pattern).
  useEffect(() => {
    setConfirmOpen(false);
  }, [policy, otherPath, otherReplacePolicy, otherDisk]);

  // Inspect the expanded “other folder” path (Data folder pattern).
  useEffect(() => {
    if (!open || policy !== "choose_other") return;
    const path = otherPath.trim();
    const gen = ++otherCheckGen.current;
    if (!path) {
      setOtherDisk("needs_folder");
      return;
    }
    setOtherDisk("checking");
    void vaultRoot
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== otherCheckGen.current) return;
        if (result.status === "incomplete") setOtherDisk("incomplete");
        else if (result.status === "unreadable") setOtherDisk("unreadable");
        else if (result.status === "absent") setOtherDisk("will_create");
        else setOtherDisk("ready");
      })
      .catch(() => {
        if (gen !== otherCheckGen.current) return;
        setOtherDisk("unreadable");
      });
  }, [open, policy, otherPath, vaultRoot]);

  const otherGate = vaultRootGateFromState({
    dirty: true,
    disk: otherDisk,
    replacePolicy: otherReplacePolicy,
  });

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const finishWithRoot = useCallback(
    async (rootPath: string, nextMode: VaultRootMode, gen: number) => {
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: nextMode,
            upriv_root_path: nextMode === "custom_root" ? rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (gen !== busyGen.current) return;
      if (!saved) {
        throw new Error("settings_save_failed");
      }
      onRepaired();
    },
    [onRepaired, patchSettings],
  );

  const applyRepairCurrent = useCallback(
    (nextPolicy: IncompleteReplacePolicy) => {
      if (submitLock.current) return;
      const gen = ++busyGen.current;
      submitLock.current = true;
      setBusy(true);
      setError(null);

      void (async () => {
        const cached = diskApplied.current;
        if (
          cached?.source === "current" &&
          cached.mode === mode &&
          cached.replacePolicy === nextPolicy &&
          samePathKey(cached.path, targetPath)
        ) {
          if (gen !== busyGen.current) return;
          await finishWithRoot(cached.rootPath, mode, gen);
          return;
        }

        let rootPath: string;
        if (mode === "default_root") {
          const status = await vaultRoot.defaultRootStatus();
          if (gen !== busyGen.current) return;
          const anchor = status.defaultRootAnchor.trim();
          const expected = targetPath.trim();
          if (anchor && expected && anchor !== expected) {
            throw new Error(
              `default_root repair targetPath (${expected}) != setup anchor (${anchor})`,
            );
          }
          const result = await vaultRoot.setupDefaultRoot({
            replaceIncomplete: true,
            replacePolicy: nextPolicy,
            bootstrap: { locale: settings.ui.locale },
          });
          rootPath = result.rootPath;
        } else {
          const result = await vaultRoot.setupAtPath(targetPath, {
            replaceIncomplete: true,
            replacePolicy: nextPolicy,
            bootstrap: { locale: settings.ui.locale },
          });
          rootPath = result.rootPath;
        }
        if (gen !== busyGen.current) return;
        diskApplied.current = {
          rootPath,
          source: "current",
          mode,
          path: targetPath.trim(),
          replacePolicy: nextPolicy,
        };
        await finishWithRoot(rootPath, mode, gen);
      })()
        .catch((err) => {
          if (gen !== busyGen.current) return;
          setError(t(desktopErrorI18nKey(err, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          if (gen !== busyGen.current) return;
          submitLock.current = false;
          setBusy(false);
        });
    },
    [finishWithRoot, mode, settings.ui.locale, t, targetPath, vaultRoot],
  );

  const handlePickOtherFolder = useCallback(() => {
    setBusy(true);
    setError(null);
    void (async () => {
      const suggested =
        otherPath.trim() ||
        targetPath.trim() ||
        (await vaultRoot.suggestedCustomRootPath().catch(() => ""));
      const picked = await vaultRoot.pickFolder(
        suggested || null,
        t("modal.vault_root_setup.pick_folder_title"),
      );
      if (!picked?.trim()) return;
      setOtherReplacePolicy(null);
      setOtherPath(picked.trim());
    })()
      .catch((err) => {
        setError(t(desktopErrorI18nKey(err, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => setBusy(false));
  }, [otherPath, t, targetPath, vaultRoot]);

  const applyOtherFolder = useCallback(() => {
    if (submitLock.current) return;
    const path = otherPath.trim();
    if (!path) {
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }
    if (otherGate.blocksPrimary) return;

    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      const cached = diskApplied.current;
      if (
        cached?.source === "other" &&
        cached.mode === "custom_root" &&
        cached.replacePolicy === (otherReplacePolicy ?? null) &&
        samePathKey(cached.path, path)
      ) {
        if (gen !== busyGen.current) return;
        await finishWithRoot(cached.rootPath, "custom_root", gen);
        return;
      }

      const { rootPath } = await vaultRoot.setupAtPath(path, {
        replaceIncomplete: otherReplacePolicy != null,
        replacePolicy: otherReplacePolicy ?? undefined,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
      diskApplied.current = {
        rootPath,
        source: "other",
        mode: "custom_root",
        path,
        replacePolicy: otherReplacePolicy ?? null,
      };
      await finishWithRoot(rootPath, "custom_root", gen);
    })()
      .catch((err) => {
        if (gen !== busyGen.current) return;
        setError(t(desktopErrorI18nKey(err, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  }, [
    finishWithRoot,
    otherGate.blocksPrimary,
    otherPath,
    otherReplacePolicy,
    settings.ui.locale,
    t,
    vaultRoot,
  ]);

  // UI primary = Continue (blocking Repair gate — not Apply).
  const commitContinue = useCallback(() => {
    if (policy === "choose_other") {
      applyOtherFolder();
      return;
    }
    applyRepairCurrent(policy);
  }, [applyOtherFolder, applyRepairCurrent, policy]);

  // UI primary = Continue
  const requestContinue = useCallback(() => {
    if (busy || confirmOpen) return;
    if (policy === "choose_other" && otherGate.blocksPrimary) return;
    setConfirmOpen(true);
  }, [busy, confirmOpen, otherGate.blocksPrimary, policy]);

  if (!open) return null;

  const noteKeys =
    policy === "choose_other"
      ? otherGate.confirmNotes
      : confirmNotesForReplacePolicy(policy === "delete" || policy === "rename" ? policy : null);

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_repair.title")}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      footer={
        <VaultRootConfirmFooter
          busy={busy}
          blocked={policy === "choose_other" && otherGate.blocksPrimary}
          confirmOpen={confirmOpen}
          noteKeys={noteKeys}
          confirmDanger={
            policy === "delete" || (policy === "choose_other" && otherReplacePolicy === "delete")
          }
          idleStatusKey={
            policy === "choose_other" && otherDisk === "checking"
              ? "modal.vault_root_repair.checking_folder"
              : undefined
          }
          onRequestPrimary={requestContinue}
          onConfirmPrimary={commitContinue}
          onCancelConfirm={() => setConfirmOpen(false)}
          onBusyTimeout={() => {
            busyGen.current += 1;
            submitLock.current = false;
            setBusy(false);
            setConfirmOpen(false);
            setError(t("loading.timed_out"));
          }}
        />
      }
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
    >
      <div
        className="space-y-3 text-sm leading-relaxed text-on-surface-variant"
        onPointerDown={() => {
          if (confirmOpen) setConfirmOpen(false);
        }}
      >
        <p>
          {t(
            mode === "custom_root"
              ? "modal.vault_root_repair.body_custom"
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
          <PolicyRadioOption
            groupName={policyGroup}
            value="choose_other"
            checked={policy === "choose_other"}
            attention={policy === "choose_other" && otherGate.blocksPrimary}
            title={t("modal.vault_root_repair.option_choose_other")}
            description={t("modal.vault_root_repair.choose_other_hint")}
            onSelect={() => {
              setPolicy("choose_other");
              setError(null);
            }}
            footer={
              policy === "choose_other" ? (
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <input
                      type="text"
                      readOnly
                      value={otherPath}
                      placeholder={t("modal.vault_root_setup.path_placeholder")}
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
                      onClick={handlePickOtherFolder}
                    >
                      {t("modal.app_settings.action.choose_folder")}
                    </Button>
                  </div>
                  {otherDisk === "checking" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </p>
                  ) : null}
                  {otherDisk === "needs_folder" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.vault_root_setup.error_path_required")}
                    </p>
                  ) : null}
                  {otherDisk === "unreadable" ? (
                    <p
                      className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                      role="alert"
                    >
                      {t("modal.vault_root_setup.error_io")}
                    </p>
                  ) : null}
                  {otherDisk === "incomplete" ? (
                    <VaultRootIncompleteReplacePanel
                      context={{ kind: "custom_root", path: otherPath.trim() }}
                      replacePolicy={otherReplacePolicy}
                      onReplacePolicyChange={(next) => {
                        setOtherReplacePolicy(next);
                        setError(null);
                      }}
                      groupName={otherRepairGroup}
                      primaryAction="continue"
                    />
                  ) : null}
                </div>
              ) : null
            }
          />
        </div>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("modal.vault_root_repair.inspect_hint")}
        </p>
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
