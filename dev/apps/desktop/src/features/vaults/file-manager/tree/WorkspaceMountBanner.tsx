import { useEffect, useState } from "react";
import { isTauri, TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { useTranslation } from "@/i18n";
import {
  getWorkspaceMountKind,
  type WorkspaceMountKindLabel,
} from "@/platform/tauri/vaultLifecycleService";

interface WorkspaceMountStatus {
  mountKind: WorkspaceMountKindLabel;
  fuseVerified: boolean;
}

interface WorkspaceMountBannerProps {
  vaultId: string;
  storageMode: string;
}

function labelKey(
  kind: WorkspaceMountKindLabel | "plain",
):
  | "modal.file_manager.mount.virtual_fuse"
  | "modal.file_manager.mount.dev_plaintext"
  | "modal.file_manager.mount.plain" {
  if (kind === "virtual_fuse") return "modal.file_manager.mount.virtual_fuse";
  if (kind === "dev_plaintext") return "modal.file_manager.mount.dev_plaintext";
  return "modal.file_manager.mount.plain";
}

export function WorkspaceMountBanner({ vaultId, storageMode }: WorkspaceMountBannerProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WorkspaceMountStatus | null>(null);

  useEffect(() => {
    if (storageMode === "plain") {
      setStatus({ mountKind: "dev_plaintext", fuseVerified: false });
      return;
    }
    if (storageMode !== "encrypted_dir") {
      setStatus(null);
      return;
    }

    const cached = getWorkspaceMountKind(vaultId);
    if (cached) {
      setStatus({ mountKind: cached, fuseVerified: cached === "virtual_fuse" });
    }

    if (!isTauri()) return;

    void tauriInvoke<WorkspaceMountStatus | null>(TAURI_COMMANDS.VAULT_WORKSPACE_MOUNT_STATUS, {
      vaultId,
    }).then((next) => {
      if (next) setStatus(next);
    });
  }, [storageMode, vaultId]);

  if (!status) return null;

  const isWarning =
    storageMode === "plain" ||
    status.mountKind === "dev_plaintext" ||
    (status.mountKind === "virtual_fuse" && !status.fuseVerified);

  const kind: WorkspaceMountKindLabel | "plain" =
    storageMode === "plain" ? "plain" : status.mountKind;

  return (
    <div
      className={[
        "mx-2 mb-1 rounded-md px-2 py-1 text-[10px] leading-snug",
        isWarning
          ? "bg-[var(--vault-status-recovery)]/15 text-on-surface-variant"
          : "bg-surface-container-highest/60 text-on-surface-variant",
      ].join(" ")}
      role="status"
    >
      {t(labelKey(kind))}
      {status.mountKind === "virtual_fuse" && status.fuseVerified
        ? ` · ${t("modal.file_manager.mount.fuse_verified")}`
        : null}
      {status.mountKind === "virtual_fuse" && !status.fuseVerified
        ? ` · ${t("modal.file_manager.mount.fuse_not_verified")}`
        : null}
    </div>
  );
}
