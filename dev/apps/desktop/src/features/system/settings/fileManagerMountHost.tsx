import { useEffect, useState } from "react";
import { currentWorkspaceSystem } from "@upriv/shared";
import { Button } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcFuseInstall, rpcFuseStatus, rpcWinFspInstall, rpcWinFspStatus } from "@/lib/rpc";

export type MountHostKind = "winfsp" | "fuse" | "none";

/** Windows uses WinFsp. Linux uses the distro FUSE package. Other systems have no OS folder driver. */
function mountHostKind(): MountHostKind {
  if (!isElectronRenderer()) return "none";
  const system = currentWorkspaceSystem();
  if (system === "windows") return "winfsp";
  if (system === "linux") return "fuse";
  return "none";
}

export function useFileManagerMountHost() {
  const kind = mountHostKind();
  const applicable = kind !== "none";
  const [known, setKnown] = useState(!applicable);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!applicable) return;
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
  }, [applicable, kind]);

  async function ensureInstalled(): Promise<boolean> {
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

export function FileManagerDriverNotice({
  kind,
  missing,
  busy,
  onInstall,
}: {
  kind: MountHostKind;
  missing: boolean;
  busy: boolean;
  onInstall: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  if (!missing || kind === "none") return null;
  const missingKey: I18nKey =
    kind === "fuse"
      ? "modal.app_settings.field.workspace.fuse_missing"
      : "modal.app_settings.field.workspace.driver_missing";
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
      <p className="text-xs leading-relaxed text-on-error-container" role="status">
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
