import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";
import { Button, type ButtonProps } from "./Button";

const modalChromeButtonClass =
  "h-9 w-9 min-h-9 min-w-9 shrink-0 px-0 text-lg leading-none sm:h-10 sm:w-10 sm:min-h-10 sm:min-w-10";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Nested modals share one body overflow lock — restore only when the last closes. */
let openModalCount = 0;

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
    openModalCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = "";
      }
    };
  }, [open]);

  // Focus the dialog once on open + Tab cycle. Do not steal focus on every
  // children/footer/headerActions change (locale <select>). When a focused
  // control unmounts (focus leaves the panel), restore focus to the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );

    panel.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Panel itself is focusable (tabIndex=-1) for initial focus — treat as outside the cycle.
      const onPanelChrome = active === panel || !panel.contains(active);
      if (event.shiftKey) {
        if (active === first || onPanelChrome) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || onPanelChrome) {
        event.preventDefault();
        first.focus();
      }
    };

    // Recover when focus escapes the dialog (e.g. Continue unmounted mid-step).
    // Ignore focus moving into another portaled UI (native <select> listbox).
    const recoverIfFocusLeft = () => {
      const active = document.activeElement;
      if (active instanceof Node && panel.contains(active)) return;
      if (active instanceof Element) {
        const role = active.getAttribute("role");
        if (role === "listbox" || role === "option") return;
      }
      panel.focus({ preventScroll: true });
    };

    const onFocusIn = (event: FocusEvent) => {
      const next = event.target;
      if (next instanceof Node && panel.contains(next)) return;
      // Focus moved elsewhere in the document — schedule recovery after the
      // current unmount/remount settles (locale select keeps focus on itself).
      queueMicrotask(recoverIfFocusLeft);
    };

    const observer = new MutationObserver(() => {
      const active = document.activeElement;
      if (active instanceof Node && panel.contains(active)) return;
      if (active === document.body || active === document.documentElement || active == null) {
        panel.focus({ preventScroll: true });
      }
    });
    observer.observe(panel, { childList: true, subtree: true });

    panel.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (active instanceof Node && panel.contains(active)) return;
    panel.focus({ preventScroll: true });
  }, [open]);

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
          tabIndex={-1}
          className={[
            "pointer-events-auto flex h-fit w-full max-h-[min(92dvh,calc(100dvh-1.5rem))] flex-col overflow-hidden bg-surface-container-high shadow-modal",
            "rounded-xl",
            "p-4 sm:p-6",
            "outline-none",
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
              "modal-scroll-pane min-h-0 text-body text-on-surface overflow-y-auto",
              // Grow to fill space under max-height so long forms scroll with a sticky footer.
              // Short modals still size to content (panel height is auto + max-h, not forced).
              scrollFooterLayout ? "flex-1" : "",
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
