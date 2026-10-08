import { createPortal } from "react-dom";
import type { ToastState } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

export interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  className?: string;
}

export function Toast({ toast, onDismiss, className }: ToastProps) {
  const { t } = useTranslation();

  if (!toast) return null;

  return createPortal(
    <div
      role="alert"
      className={[
        "pointer-events-auto fixed bottom-6 left-1/2 z-[120] flex w-[min(90vw,28rem)] -translate-x-1/2 items-center gap-3 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-high py-3 pl-4 pr-2 text-sm text-on-surface shadow-modal",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="min-w-0 flex-1 break-words leading-snug">{toast.message}</p>
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        aria-label={t("action.close")}
        onClick={onDismiss}
      >
        <Icon name="close" size={16} className="block" />
      </button>
      {toast.durationMs > 0 ? (
        <span
          key={toast.id}
          aria-hidden
          className="toast-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent"
          style={{ animationDuration: `${toast.durationMs}ms` }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
