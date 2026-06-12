import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";

export interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  className?: string;
}

export function Toast({ message, onDismiss, className }: ToastProps) {
  const { t } = useTranslation();

  if (!message) return null;

  return createPortal(
    <div
      className={[
        "pointer-events-auto fixed bottom-6 left-1/2 z-[120] flex max-w-[min(90vw,28rem)] -translate-x-1/2 items-start gap-2 rounded-xl bg-surface-container-high py-3 pl-4 pr-2 text-sm text-on-surface shadow-modal",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="min-w-0 flex-1 leading-snug">{message}</p>
      <button
        type="button"
        className="shrink-0 rounded-md px-1.5 py-0.5 text-lg leading-none text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        aria-label={t("action.close")}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
