import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import {
  isVaultOpenCredentialResumeStatus,
  type VaultDisplayStatus,
  type VaultRowButtonRole,
} from "@upriv/shared";
import { vaultStatusI18nKey } from "@/theme";
import { ROW_ARM_ATTR } from "@/hooks/useRowArmingDismiss";

/** Fixed control size — all vault rows (Lock / Unlock / Stop). */
const LOCK_CONTROL_CLASS = "inline-flex h-11 w-36 shrink-0 items-center justify-center";
const LOCK_ICON_CLASS = "inline-flex h-11 w-11 shrink-0 items-center justify-center";

const UNLOCK_SURFACE_CLASS = "bg-surface-container-highest text-on-surface hover:brightness-110";
const LOCK_SURFACE_CLASS =
  "bg-[color-mix(in_srgb,var(--primary)_30%,var(--surface-container-highest))] text-on-surface hover:brightness-110";
/** Armed: waiting for the second press. Same pulse as a busy status badge. */
const ARMED_SURFACE_CLASS = "bg-error-container text-on-error-container motion-safe:animate-pulse";

interface VaultLockButtonProps {
  vaultId: string;
  status: VaultDisplayStatus;
  role: VaultRowButtonRole;
  /** The first press armed the button; the next one runs it. */
  armed: boolean;
  /** Runs an action through the row's arming. */
  press: (action: () => void) => void;
  /** `block` — full-width control for grid cards. */
  layout?: "inline" | "block";
  /** Compact / small screens — glyph instead of the 9rem label. */
  appearance?: "label" | "icon";
  /** Waiting open can reopen the password dialog. A queued close cannot. */
  resumeUnlock?: boolean;
  onLock?: () => void;
  onUnlock?: () => void;
  onStop?: () => void;
}

function roleCopy(
  role: VaultRowButtonRole,
  armed: boolean,
  status: VaultDisplayStatus,
): { icon: IconName; label: I18nKey; aria: I18nKey } {
  switch (role) {
    case "stop":
      return armed
        ? { icon: "close", label: "action.confirm_stop", aria: "action.press_again_to_stop" }
        : { icon: "close", label: "action.stop", aria: "action.stop" };
    case "stop_final":
      return { icon: "close", label: "action.stop", aria: "action.stop_final" };
    case "stopping":
      return { icon: "close", label: "vault.status.stopping", aria: "vault.status.stopping" };
    case "lock":
      return armed
        ? { icon: "lock", label: "action.confirm_lock", aria: "action.press_again_to_lock" }
        : { icon: "lock", label: "action.lock", aria: "action.lock" };
    case "unlock":
      return { icon: "lock-open", label: "action.unlock", aria: "action.unlock" };
    case "busy":
      return {
        icon: "lock-open",
        label: vaultStatusI18nKey[status],
        aria: vaultStatusI18nKey[status],
      };
  }
}

/**
 * The row's open/close button. While the row's work can stop it is Stop, in
 * the same place. A press goes through the row's arming, so it may wait for a
 * second press (System settings).
 */
export function VaultLockButton({
  vaultId,
  status,
  role,
  armed,
  press,
  layout = "inline",
  appearance = "label",
  resumeUnlock,
  onLock,
  onUnlock,
  onStop,
}: VaultLockButtonProps) {
  const { t } = useTranslation();
  const iconOnly = appearance === "icon" && layout !== "block";
  const controlSizeClass = iconOnly
    ? LOCK_ICON_CLASS
    : layout === "block"
      ? "inline-flex h-10 w-full items-center justify-center"
      : LOCK_CONTROL_CLASS;
  const labelClass = "truncate font-mono text-sm font-medium";
  const copy = roleCopy(role, armed, status);

  // Work without a row Stop: the button says what runs. A waiting open can reopen its password.
  const resumeOpenCredential =
    role === "busy" && (resumeUnlock ?? isVaultOpenCredentialResumeStatus(status));
  const inert =
    role === "stop_final" || role === "stopping" || (role === "busy" && !resumeOpenCredential);

  const run = () => {
    if (role === "stop") press(() => onStop?.());
    else if (role === "lock") press(() => onLock?.());
    else if (role === "unlock") press(() => onUnlock?.());
    else if (resumeOpenCredential) onUnlock?.();
  };

  const surfaceClass = armed
    ? ARMED_SURFACE_CLASS
    : role === "lock"
      ? LOCK_SURFACE_CLASS
      : UNLOCK_SURFACE_CLASS;

  return (
    <button
      type="button"
      {...{ [ROW_ARM_ATTR]: vaultId }}
      disabled={inert}
      aria-busy={role === "busy" || role === "stopping" || undefined}
      aria-label={t(copy.aria)}
      title={role === "stop_final" ? t("action.stop_final") : undefined}
      className={[
        controlSizeClass,
        "rounded-xl transition-colors",
        inert ? "cursor-not-allowed opacity-70" : "",
        role === "busy" && resumeOpenCredential ? "opacity-70" : "",
        surfaceClass,
        iconOnly ? "" : `${labelClass} gap-1.5 px-2`,
      ].join(" ")}
      onClick={(event) => {
        event.stopPropagation();
        run();
      }}
    >
      {iconOnly ? (
        <Icon name={copy.icon} size={20} />
      ) : (
        <>
          <Icon name={copy.icon} size={18} className="shrink-0" />
          <span className="min-w-0 truncate">{t(copy.label)}</span>
        </>
      )}
    </button>
  );
}
