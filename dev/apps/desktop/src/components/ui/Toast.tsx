import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
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
      role="alert"
      className={[
        "pointer-events-auto fixed bottom-6 left-1/2 z-[120] flex w-[min(90vw,28rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-high py-3 pl-4 pr-2 text-sm text-on-surface shadow-modal",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="min-w-0 flex-1 break-words leading-snug">{message}</p>
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        aria-label={t("action.close")}
        onClick={onDismiss}
      >
        <Icon name="close" size={16} className="block" />
      </button>
    </div>,
    document.body,
  );
}
