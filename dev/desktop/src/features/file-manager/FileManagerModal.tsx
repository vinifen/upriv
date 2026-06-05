import { type ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface FileManagerModalProps {
  open: boolean;
  title: string;
  onMinimize: () => void;
  onClose: () => void;
  children: ReactNode;
}

export function FileManagerModal({
  open,
  title,
  onMinimize,
  onClose,
  children,
}: FileManagerModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMinimize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onMinimize]);

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
        className="absolute inset-0 bg-[var(--modal-scrim)] backdrop-blur-sm"
        aria-hidden
        onClick={onMinimize}
      />
      <div className="pointer-events-none relative z-10 flex h-[100dvh] w-full items-stretch justify-center p-0 sm:h-full sm:items-center sm:p-2">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={[
            "pointer-events-auto flex h-full min-h-0 w-full max-w-[min(98vw,96rem)] flex-col overflow-hidden",
            "bg-surface-container-high shadow-modal",
            "rounded-none sm:h-[min(94vh,calc(100vh-1rem))] sm:max-h-[min(94vh,calc(100vh-1rem))] sm:rounded-xl",
          ].join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-10 shrink-0 items-center justify-between gap-2 px-4 sm:px-5">
            <h2
              id={titleId}
              className="min-w-0 flex-1 truncate font-display text-sm font-semibold leading-none text-on-surface"
            >
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                onClick={onMinimize}
                aria-label={t("modal.file_manager.action.minimize")}
                title={t("modal.file_manager.action.minimize")}
              >
                <Icon name="minus" size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0 text-base leading-none"
                onClick={onClose}
                aria-label={t("modal.file_manager.action.close")}
                title={t("modal.file_manager.action.close")}
              >
                ×
              </Button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-body text-on-surface">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
