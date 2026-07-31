import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
  type AppDistribution,
  type LocaleId,
  type VaultRootMode,
  type VaultRootPresentationState,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";
import { VaultRootLocationSection } from "./VaultRootLocationSection";
import { VAULT_ROOT_GATE_IDLE, type VaultRootSettingsGate } from "./vaultRootSettingsIntent";

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

/**
 * Blocking first-run when no vault-root is found.
 * Reuses `VaultRootLocationSection` (same inspect / incomplete UX as Data folder).
 */
export function VaultRootSetupModal({
  open,
  presentation,
  distribution,
  onConfigured,
}: VaultRootSetupModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const aliasPath = presentation.aliasPath;
  const { settings, patchSettings } = useAppSettingsContext();
  const [mode, setMode] = useState<VaultRootMode>("default_root");
  const [path, setPath] = useState("");
  const [gate, setGate] = useState<VaultRootSettingsGate>(VAULT_ROOT_GATE_IDLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inspectNonce, setInspectNonce] = useState(0);
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const openedSessionRef = useRef(false);

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      return;
    }
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setMode("default_root");
    setPath("");
    setGate(VAULT_ROOT_GATE_IDLE);
    setBusy(false);
    setError(null);
    setConfirmOpen(false);
    setInspectNonce(0);
    submitLock.current = false;
    busyGen.current += 1;
    diskApplied.current = null;
  }, [open]);

  useEffect(() => {
    setConfirmOpen(false);
  }, [mode, path, gate.replacePolicy, gate.disk]);

  const onVaultRootGateChange = useCallback((next: VaultRootSettingsGate) => {
    setGate(next);
  }, []);

  const onDraftChange = useCallback(
    (patch: { vault_root_mode?: VaultRootMode; upriv_root_path?: string }) => {
      if (patch.vault_root_mode != null) setMode(patch.vault_root_mode);
      if (patch.upriv_root_path != null) setPath(patch.upriv_root_path);
      setError(null);
    },
    [],
  );

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const finish = useCallback(
    async (rootPath: string, nextMode: VaultRootMode, gen: number) => {
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
      if (gen !== busyGen.current) return;
      if (!saved) {
        throw new Error("settings_save_failed");
      }
      onConfigured();
    },
    [onConfigured, patchSettings],
  );

  // UI primary = Continue (blocking first-run Setup — not Apply).
  const requestContinue = useCallback(() => {
    const current = gateRef.current;
    if (busy || current.blocksPrimary || confirmOpen) return;
    setConfirmOpen(true);
  }, [busy, confirmOpen]);

  // UI primary = Continue
  const commitContinue = useCallback(() => {
    const current = gateRef.current;
    if (current.blocksPrimary || busy || submitLock.current) return;

    if (mode === "default_root") {
      const gen = ++busyGen.current;
      submitLock.current = true;
      setBusy(true);
      setError(null);
      void (async () => {
        if (diskApplied.current?.mode === "default_root") {
          if (gen !== busyGen.current) return;
          await finish(diskApplied.current.rootPath, "default_root", gen);
          return;
        }
        const { rootPath } = await vaultRoot.setupDefaultRoot({
          replaceIncomplete: current.replacePolicy != null,
          replacePolicy: current.replacePolicy,
          bootstrap: { locale: settings.ui.locale },
        });
        if (gen !== busyGen.current) return;
        await finish(rootPath, "default_root", gen);
      })()
        .catch((caught) => {
          if (gen !== busyGen.current) return;
          if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
            setInspectNonce((n) => n + 1);
            setError(null);
            return;
          }
          setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          if (gen !== busyGen.current) return;
          submitLock.current = false;
          setBusy(false);
        });
      return;
    }

    const nextPath = path.trim();
    if (!nextPath) {
      setConfirmOpen(false);
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }

    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      const applied = diskApplied.current;
      if (
        applied?.mode === "custom_root" &&
        current.replacePolicy == null &&
        samePathKey(applied.rootPath, nextPath)
      ) {
        if (gen !== busyGen.current) return;
        await finish(applied.rootPath, "custom_root", gen);
        return;
      }
      if (applied && !samePathKey(applied.rootPath, nextPath)) {
        diskApplied.current = null;
      }
      const { rootPath } = await vaultRoot.setupAtPath(nextPath, {
        replaceIncomplete: current.replacePolicy != null,
        replacePolicy: current.replacePolicy,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
      await finish(rootPath, "custom_root", gen);
    })()
      .catch((caught) => {
        if (gen !== busyGen.current) return;
        if (
          current.replacePolicy == null &&
          isRpcError(caught) &&
          caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE
        ) {
          setInspectNonce((n) => n + 1);
          setError(null);
          return;
        }
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  }, [busy, finish, mode, path, settings.ui.locale, t, vaultRoot]);

  const setupBodyKey =
    distribution === "installed"
      ? "modal.vault_root_setup.body_installed"
      : distribution === "dev"
        ? "modal.vault_root_setup.body_dev"
        : "modal.vault_root_setup.body_portable";

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_setup.title")}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      footer={
        <VaultRootConfirmFooter
          busy={busy}
          blocked={gate.blocksPrimary}
          confirmOpen={confirmOpen}
          noteKeys={gate.confirmNotes}
          confirmDanger={gate.replacePolicy === "delete"}
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
        <p>{t(setupBodyKey)}</p>
        <VaultRootLocationSection
          config={{ vault_root_mode: mode, upriv_root_path: path }}
          onChange={onDraftChange}
          savedVaultRootMode="default_root"
          savedRootPath=""
          forceDirty
          primaryAction="continue"
          controlsDisabled={busy}
          inspectNonce={inspectNonce}
          onVaultRootGateChange={onVaultRootGateChange}
          customRootNotice={
            <p className="text-xs leading-relaxed text-on-surface-variant">
              {t("modal.vault_root_setup.alias_notice", {
                file: VAULT_ROOT_ALIAS_FILE,
                aliasPath,
              })}
            </p>
          }
        />
        {error ? (
          <p
            className="rounded-md bg-error-container/10 px-3 py-2 text-sm text-on-error-container"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t("modal.vault_root_setup.busy")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
