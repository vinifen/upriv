import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { menuItemClass, menuPanelClass } from "@/components/ui/menuStyles";
import { useTranslation } from "@/i18n";
import type { VaultDisplayStatus } from "@/types";
import { vaultStatusI18nKey } from "@/theme";

/** Fixed control size — all vault rows (Lock / Unlock / sealed, with or without chevron). */
const LOCK_CONTROL_CLASS = "h-11 w-36 shrink-0";
const LOCK_MAIN_CLASS = "flex h-full min-w-0 flex-1 items-center justify-center px-3";
const LOCK_CHEVRON_CLASS = "flex h-full w-11 shrink-0 items-center justify-center";

interface VaultLockButtonProps {
  status: VaultDisplayStatus;
  /** `block` — full-width control for grid cards. */
  layout?: "inline" | "block";
  onLock?: () => void;
  onUnlock?: () => void;
  onSeal?: () => void;
}

export function VaultLockButton({
  status,
  layout = "inline",
  onLock,
  onUnlock,
  onSeal,
}: VaultLockButtonProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const controlSizeClass = layout === "block" ? "h-10 w-full" : LOCK_CONTROL_CLASS;

  const isOpen = status === "open";
  const pipelineBusy = status === "closing" || status === "opening";
  const isSealed = status === "sealed";
  const showSealSplit = !isSealed && !pipelineBusy;
  const label = isOpen ? t("action.lock") : t("action.unlock");

  const unlockSurfaceClass = "bg-surface-container-highest text-on-surface hover:brightness-110";
  const lockSurfaceClass =
    "bg-[color-mix(in_srgb,var(--primary)_30%,var(--surface-container-highest))] text-on-surface hover:brightness-110";

  const surfaceClass = isOpen ? lockSurfaceClass : unlockSurfaceClass;

  const labelClass = "truncate font-mono text-sm font-medium";

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const handleMainAction = () => {
    setMenuOpen(false);
    if (isOpen) {
      onLock?.();
    } else {
      onUnlock?.();
    }
  };

  const handleSeal = () => {
    setMenuOpen(false);
    onSeal?.();
  };

  if (pipelineBusy) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        className={[
          controlSizeClass,
          "cursor-not-allowed rounded-xl opacity-70",
          unlockSurfaceClass,
          labelClass,
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        {t(vaultStatusI18nKey[status])}
      </button>
    );
  }

  if (!showSealSplit) {
    return (
      <button
        type="button"
        className={[
          controlSizeClass,
          "rounded-xl transition-colors",
          surfaceClass,
          labelClass,
        ].join(" ")}
        onClick={(event) => {
          event.stopPropagation();
          handleMainAction();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      ref={rootRef}
      className={[
        "relative flex flex-col items-stretch",
        layout === "block" ? "w-full" : "w-36",
      ].join(" ")}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={[
          controlSizeClass,
          "inline-flex items-stretch overflow-hidden rounded-xl",
        ].join(" ")}
      >
        <button
          type="button"
          className={[LOCK_MAIN_CLASS, "transition-colors", surfaceClass, labelClass].join(" ")}
          onClick={handleMainAction}
        >
          <span className="truncate">{label}</span>
        </button>
        <span
          aria-hidden
          className="w-px shrink-0 self-stretch bg-[var(--split-divider)]"
        />
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-controls={menuId}
          className={[
            LOCK_CHEVRON_CLASS,
            "transition-colors",
            surfaceClass,
            menuOpen ? "opacity-90" : "",
          ].join(" ")}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <Icon
            name="chevron-down"
            size={18}
            className={["transition-transform duration-200", menuOpen ? "rotate-180" : ""].join(" ")}
          />
        </button>
      </div>

      {menuOpen ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("action.seal")}
          className={["absolute inset-x-0 top-full z-50 mt-1.5 min-w-full", menuPanelClass].join(" ")}
        >
          <button
            type="button"
            role="menuitem"
            className={[menuItemClass, "justify-center px-5"].join(" ")}
            onClick={handleSeal}
          >
            <Icon name="seal" size={18} />
            {t("action.seal")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
