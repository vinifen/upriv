import { useEffect, useState } from "react";
import { useDeviceInfo } from "@upriv/shared/react";
import { Button } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcFuseInstall, rpcFuseStatus, rpcWinFspInstall, rpcWinFspStatus } from "@/lib/rpc";
import { useDeviceService } from "@/platform/services";

export type UnlockedFolderDriverKind = "winfsp" | "fuse" | "none";

/**
 * The driver an encrypted vault's unlocked folder needs on this computer:
 * WinFsp on Windows, the distro FUSE package on Linux, none elsewhere.
 * `known` stays false until the device and the driver's status are read; a
 * switch that turns a folder on waits for it.
 */
export function useUnlockedFolderDriver() {
  const device = useDeviceInfo(useDeviceService());
  const kind: UnlockedFolderDriverKind = !isElectronRenderer()
    ? "none"
    : device?.system === "windows"
      ? "winfsp"
      : device?.system === "linux"
        ? "fuse"
        : "none";
  const applicable = kind !== "none";
  const [known, setKnown] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!applicable) {
      setKnown(device !== null);
      return;
    }
    let cancelled = false;
    const status = kind === "fuse" ? rpcFuseStatus() : rpcWinFspStatus();
    void status
      .then((row) => {
        if (cancelled) return;
        setMissing(row.applicable && !row.installed);
        setKnown(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMissing(true);
        setKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [applicable, device, kind]);

  /** True once the driver is there: installed now when it was missing. False before it is known. */
  async function ensureInstalled(): Promise<boolean> {
    if (!known) return false;
    if (!applicable || !missing) return true;
    setBusy(true);
    try {
      const ok = kind === "fuse" ? await rpcFuseInstall() : await rpcWinFspInstall();
      setMissing(!ok);
      return ok;
    } catch {
      setMissing(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { missing, known, busy, ensureInstalled, kind };
}

/**
 * The driver is missing while a folder is wanted: a step the person can take,
 * so it reads in the attention color, with its install button.
 */
export function UnlockedFolderDriverNotice({
  kind,
  missing,
  busy,
  onInstall,
}: {
  kind: UnlockedFolderDriverKind;
  missing: boolean;
  busy: boolean;
  onInstall: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  if (!missing || kind === "none") return null;
  const missingKey: I18nKey =
    kind === "fuse"
      ? "unlocked_folder.driver.fuse_missing"
      : "unlocked_folder.driver.winfsp_missing";
  const installKey: I18nKey =
    kind === "fuse"
      ? "modal.app_settings.action.install_fuse"
      : "modal.app_settings.action.install_driver";
  const busyKey: I18nKey =
    kind === "fuse"
      ? "modal.app_settings.action.install_fuse_busy"
      : "modal.app_settings.action.install_driver_busy";
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs leading-relaxed text-vault-recovery" role="status">
        {t(missingKey)}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={busy}
        onClick={() => {
          void onInstall();
        }}
      >
        {busy ? t(busyKey) : t(installKey)}
      </Button>
    </div>
  );
}
