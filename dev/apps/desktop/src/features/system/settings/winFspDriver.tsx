import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcWinFspInstall, rpcWinFspStatus } from "@/lib/rpc";
import { currentWorkspaceSystem } from "@upriv/shared";

/** Windows Electron only. Other systems already have their folder, or no driver. */
function driverApplies(): boolean {
  return currentWorkspaceSystem() === "windows" && isElectronRenderer();
}

export function useWinFspDriver() {
  const applicable = driverApplies();
  const [known, setKnown] = useState(!applicable);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!applicable) return;
    let cancelled = false;
    void rpcWinFspStatus()
      .then((status) => {
        if (cancelled) return;
        setMissing(status.applicable && !status.installed);
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
  }, [applicable]);

  async function ensureInstalled(): Promise<boolean> {
    if (!applicable || !missing) return true;
    setBusy(true);
    try {
      const ok = await rpcWinFspInstall();
      setMissing(!ok);
      return ok;
    } catch {
      setMissing(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { missing, known, busy, ensureInstalled };
}

export function FileManagerDriverNotice({
  missing,
  busy,
  onInstall,
}: {
  missing: boolean;
  busy: boolean;
  onInstall: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  if (!missing) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs leading-relaxed text-on-error-container" role="status">
        {t("modal.app_settings.field.workspace.driver_missing")}
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
        {busy
          ? t("modal.app_settings.action.install_driver_busy")
          : t("modal.app_settings.action.install_driver")}
      </Button>
    </div>
  );
}
