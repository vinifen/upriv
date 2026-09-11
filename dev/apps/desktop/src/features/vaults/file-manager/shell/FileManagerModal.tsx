import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { ModalChromeButton, ModalTitleCluster } from "@/components/ui";
import { acquireScrollLock, releaseScrollLock } from "@/components/ui/scrollLock";
import { useTranslation } from "@/i18n";

interface FileManagerModalProps {
  open: boolean;
  title: string;
  contextTitle?: string;
  titleIcon?: IconName;
  onMinimize: () => void;
  onDismiss: () => void;
  /** When true, Escape and backdrop click do not minimize (unsaved dialog is active). */
  suspendMinimize?: boolean;
  children: ReactNode;
}

export function FileManagerModal({
  open,
  title,
  contextTitle,
  titleIcon = "file-manager",
  onMinimize,
  onDismiss,
  suspendMinimize = false,
  children,
}: FileManagerModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const contextId = useId();
  const scrimStart = useRef<{ x: number; y: number } | null>(null);

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
    acquireScrollLock();
    return () => releaseScrollLock();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-[var(--modal-scrim)] backdrop-blur-sm"
        aria-hidden
        onPointerDown={
          suspendMinimize
            ? undefined
            : (event) => {
                scrimStart.current = { x: event.clientX, y: event.clientY };
              }
        }
        onClick={
          suspendMinimize
            ? undefined
            : (event) => {
                const start = scrimStart.current;
                scrimStart.current = null;
                if (!start) {
                  onMinimize();
                  return;
                }
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (dx * dx + dy * dy <= 100) onMinimize();
              }
        }
      />
      <div className="pointer-events-none relative z-10 flex h-[100dvh] w-full items-center justify-center p-0 sm:h-full">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={contextTitle ? `${titleId} ${contextId}` : titleId}
          className={[
            "pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden",
            "bg-surface-container-high shadow-modal",
            "rounded-none",
            "sm:h-[calc(100vh-48px)] sm:max-h-[calc(100vh-48px)] sm:w-[calc(100vw-72px)] sm:max-w-[calc(100vw-72px)] sm:rounded-2xl",
          ].join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-4 sm:min-h-12 sm:px-5">
            <ModalTitleCluster
              titleId={titleId}
              contextId={contextId}
              title={title}
              contextTitle={contextTitle}
              titleIcon={titleIcon}
              compact
            />
            <div className="flex shrink-0 items-center self-center gap-0.5">
              <ModalChromeButton
                onClick={onMinimize}
                aria-label={t("modal.file_manager.action.minimize")}
                title={t("modal.file_manager.action.minimize")}
              >
                <Icon name="minus" size={18} className="block" />
              </ModalChromeButton>
              <ModalChromeButton
                onClick={onDismiss}
                aria-label={t("modal.file_manager.action.dismiss")}
                title={`${t("modal.file_manager.action.dismiss")}. ${t("modal.file_manager.action.dismiss_help")}`}
              >
                <Icon name="close" size={18} className="block" />
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
