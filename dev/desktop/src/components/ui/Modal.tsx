import { type ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

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
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = "max-w-lg",
}: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const scrollFooterLayout = Boolean(footer);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-[var(--modal-scrim)] backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />
      <div className="pointer-events-none relative z-10 flex min-h-full items-stretch justify-center p-0 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={[
            "pointer-events-auto w-full overflow-hidden border border-outline-variant/40 bg-surface-container-high shadow-modal",
            "rounded-none sm:rounded-xl",
            "p-4 sm:p-6",
            scrollFooterLayout
              ? "flex h-full max-h-[100dvh] flex-col sm:h-auto sm:max-h-[min(92vh,calc(100vh-2rem))]"
              : "",
            panelClassName,
          ].join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="mb-3 flex shrink-0 items-start justify-between gap-2 sm:mb-4 sm:gap-4">
            <h2
              id={titleId}
              className="min-w-0 flex-1 font-display text-base font-semibold leading-snug text-on-surface sm:text-xl"
            >
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
                ×
              </Button>
            </div>
          </header>
          <div
            className={[
              "text-body text-on-surface",
              scrollFooterLayout ? "modal-scroll-pane min-h-0 flex-1" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {children}
          </div>
          {footer ? (
            <footer className="mt-3 shrink-0 pb-[max(0px,env(safe-area-inset-bottom))] sm:mt-4">{footer}</footer>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
