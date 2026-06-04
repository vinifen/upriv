import { type ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Panel width utility (default `max-w-lg`). */
  panelClassName?: string;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
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

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />
      <div className="pointer-events-none relative z-10 flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={[
            "pointer-events-auto w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-high p-6 shadow-modal",
            panelClassName,
          ].join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-xl font-semibold text-on-surface">
              {title}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              ×
            </Button>
          </header>
          <div className="text-body text-on-surface">{children}</div>
          {footer ? <footer className="mt-6 flex justify-end gap-2">{footer}</footer> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
