import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import type { VaultDisplayStatus } from "@upriv/shared";
import { vaultStatusI18nKey } from "@/theme";

/** Fixed control size — all vault rows (Lock / Unlock). */
const LOCK_CONTROL_CLASS = "inline-flex h-11 w-36 shrink-0 items-center justify-center";
const LOCK_ICON_CLASS = "inline-flex h-11 w-11 shrink-0 items-center justify-center";

interface VaultLockButtonProps {
  status: VaultDisplayStatus;
  /** `block` — full-width control for grid cards. */
  layout?: "inline" | "block";
  /** Compact / small screens — lock / unlock glyph instead of the 9rem label. */
  appearance?: "label" | "icon";
  onLock?: () => void;
  onUnlock?: () => void;
}

export function VaultLockButton({
  status,
  layout = "inline",
  appearance = "label",
  onLock,
  onUnlock,
}: VaultLockButtonProps) {
  const { t } = useTranslation();
  const iconOnly = appearance === "icon" && layout !== "block";

  const controlSizeClass = iconOnly
    ? LOCK_ICON_CLASS
    : layout === "block"
      ? "inline-flex h-10 w-full items-center justify-center"
      : LOCK_CONTROL_CLASS;

  const isOpen = status === "open";
  const pipelineBusy = status === "closing" || status === "opening";
  const actionIcon = isOpen ? "lock" : "lock-open";
  const label = isOpen ? t("action.lock") : t("action.unlock");

  const unlockSurfaceClass = "bg-surface-container-highest text-on-surface hover:brightness-110";
  const lockSurfaceClass =
    "bg-[color-mix(in_srgb,var(--primary)_30%,var(--surface-container-highest))] text-on-surface hover:brightness-110";

  const surfaceClass = isOpen ? lockSurfaceClass : unlockSurfaceClass;
  const labelClass = "truncate font-mono text-sm font-medium";

  const handleMainAction = () => {
    if (isOpen) {
      onLock?.();
    } else {
      onUnlock?.();
    }
  };

  if (pipelineBusy) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        aria-label={t(vaultStatusI18nKey[status])}
        className={[
          controlSizeClass,
          "cursor-not-allowed rounded-xl opacity-70",
          unlockSurfaceClass,
          iconOnly ? "" : `${labelClass} gap-1.5 px-2`,
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        {iconOnly ? (
          <Icon name={actionIcon} size={20} />
        ) : (
          <>
            <Icon name={actionIcon} size={18} className="shrink-0" />
            <span className="min-w-0 truncate">{t(vaultStatusI18nKey[status])}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      className={[
        controlSizeClass,
        "rounded-xl transition-colors",
        surfaceClass,
        iconOnly ? "" : `${labelClass} gap-1.5 px-2`,
      ].join(" ")}
      onClick={(event) => {
        event.stopPropagation();
        handleMainAction();
      }}
    >
      {iconOnly ? (
        <Icon name={actionIcon} size={20} />
      ) : (
        <>
          <Icon name={actionIcon} size={18} className="shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </>
      )}
    </button>
  );
}
