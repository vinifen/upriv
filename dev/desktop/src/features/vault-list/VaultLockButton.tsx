import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { menuItemClass, menuPanelClass } from "@/components/ui/menuStyles";
import { useTranslation } from "@/i18n";
import type { VaultDisplayStatus } from "@/types";

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
  const isSealed = status === "sealed";
  const showSealSplit = !isSealed;
  const label = isOpen ? t("action.lock") : t("action.unlock");

  const surfaceClass = isOpen
    ? "bg-primary text-on-primary hover:opacity-90"
    : "bg-surface-container-highest text-on-surface hover:brightness-110";

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
        isOpen ? "shadow-lg shadow-primary/10" : "",
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
          className="w-px shrink-0 self-stretch"
          style={{
            backgroundColor: isOpen
              ? "var(--split-divider-on-primary)"
              : "var(--split-divider)",
          }}
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
