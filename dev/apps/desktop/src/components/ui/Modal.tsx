import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";
import { Button, type ButtonProps } from "./Button";

const modalChromeButtonClass =
  "h-9 w-9 min-h-9 min-w-9 shrink-0 px-0 text-lg leading-none sm:h-10 sm:w-10 sm:min-h-10 sm:min-w-10";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Header chrome control (close, minimize) — shared sizing across modals. */
export function ModalChromeButton({ className = "", ...props }: ButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={[modalChromeButtonClass, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra controls beside the close button (e.g. options menu). */
  headerActions?: ReactNode;
  /** Panel width utility (default `max-w-lg`). */
  panelClassName?: string;
  /** Stacking above other overlays (default `z-[100]`). */
  rootClassName?: string;
  /** When false, hide close control and ignore Escape / backdrop click (blocking flows). */
  dismissible?: boolean;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = "max-w-lg",
  rootClassName = "z-[100]",
  dismissible = true,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, dismissible]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Autofocus first control + Tab cycle inside the dialog (blocking setup/repair included).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );

    const initial = focusables()[0];
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open, children, footer, headerActions]);

  const scrollFooterLayout = Boolean(footer);

  if (!open) return null;

  return createPortal(
    <div className={["fixed inset-0", rootClassName].join(" ")}>
      <div
        className="absolute inset-0 bg-[var(--modal-scrim)] backdrop-blur-sm"
        aria-hidden
        onClick={dismissible ? onClose : undefined}
      />
      <div className="pointer-events-none relative z-10 flex min-h-full items-center justify-center p-3 sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={[
            "pointer-events-auto flex w-full max-h-[min(92dvh,calc(100dvh-1.5rem))] flex-col overflow-hidden bg-surface-container-high shadow-modal",
            "rounded-xl",
            "p-4 sm:p-6",
            scrollFooterLayout ? "min-h-0 sm:max-h-[min(92vh,calc(100vh-2rem))]" : "",
            panelClassName,
          ].join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="mb-3 flex min-h-10 shrink-0 items-center justify-between gap-2 sm:mb-4 sm:min-h-11 sm:gap-4">
            <h2
              id={titleId}
              className="min-w-0 flex-1 font-display text-base font-semibold leading-none text-on-surface sm:text-xl"
            >
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              {dismissible ? (
                <ModalChromeButton onClick={onClose} aria-label={t("action.close")}>
                  ×
                </ModalChromeButton>
              ) : null}
            </div>
          </header>
          <div
            className={[
              "modal-scroll-pane min-h-0 text-body text-on-surface",
              scrollFooterLayout ? "flex-1" : "overflow-y-auto",
            ].join(" ")}
          >
            {children}
          </div>
          {footer ? (
            <footer className="mt-3 shrink-0 pb-[max(0px,env(safe-area-inset-bottom))] sm:mt-4">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
