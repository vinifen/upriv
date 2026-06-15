import { type ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { ModalChromeButton } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface FileManagerModalProps {
  open: boolean;
  title: string;
  onMinimize: () => void;
  onDismiss: () => void;
  /** When true, Escape and backdrop click do not minimize (unsaved dialog is active). */
  suspendMinimize?: boolean;
  children: ReactNode;
}

export function FileManagerModal({
  open,
  title,
  onMinimize,
  onDismiss,
  suspendMinimize = false,
  children,
}: FileManagerModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (suspendMinimize) return;
        onMinimize();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onMinimize, suspendMinimize]);

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
        onClick={suspendMinimize ? undefined : onMinimize}
      />
      <div className="pointer-events-none relative z-10 flex h-[100dvh] w-full items-center justify-center p-0 sm:h-full">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={[
            "pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden",
            "bg-surface-container-high shadow-modal",
            "rounded-none",
            "sm:h-[calc(100vh-48px)] sm:max-h-[calc(100vh-48px)] sm:w-[calc(100vw-72px)] sm:max-w-[calc(100vw-72px)] sm:rounded-xl",
          ].join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-4 sm:min-h-12 sm:px-5">
            <h2
              id={titleId}
              className="min-w-0 flex-1 truncate font-display text-sm font-semibold leading-none text-on-surface sm:text-base"
            >
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <ModalChromeButton
                onClick={onMinimize}
                aria-label={t("modal.file_manager.action.minimize")}
                title={t("modal.file_manager.action.minimize")}
              >
                <Icon name="minus" size={18} />
              </ModalChromeButton>
              <ModalChromeButton
                onClick={onDismiss}
                aria-label={t("modal.file_manager.action.dismiss")}
                title={`${t("modal.file_manager.action.dismiss")}. ${t("modal.file_manager.action.dismiss_help")}`}
              >
                ×
              </ModalChromeButton>
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
