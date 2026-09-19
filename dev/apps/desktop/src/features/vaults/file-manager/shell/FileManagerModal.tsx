import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { ModalChromeButton, ModalTitleCluster } from "@/components/ui";
import { acquireScrollLock, releaseScrollLock } from "@/components/ui/scrollLock";
import { useTranslation } from "@/i18n";
import {
  MODAL_CLOSE_MS,
  MODAL_OPEN_MS,
  MODAL_SCALE_FROM,
  acquireOpenModal,
  releaseOpenModal,
} from "@upriv/shared";

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
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      return;
    }
    setVisible(false);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setMounted(false);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), MODAL_CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted || visible) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVisible(true);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        void panelRef.current?.offsetHeight;
        setVisible(true);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, mounted, visible]);

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
    if (!mounted) return;
    acquireScrollLock();
    return () => releaseScrollLock();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    acquireOpenModal();
    return () => releaseOpenModal();
  }, [mounted]);

  if (!mounted) return null;

  const motionMs = visible ? MODAL_OPEN_MS : MODAL_CLOSE_MS;
  const panelMotion: CSSProperties = {
    transitionDuration: `${motionMs}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    opacity: visible ? 1 : 0,
    transform: visible ? "scale(1)" : `scale(${MODAL_SCALE_FROM})`,
    willChange: "opacity, transform",
  };

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        className={[
          "absolute inset-0 bg-[var(--modal-scrim)] transition-opacity motion-reduce:!transition-none",
          visible ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{
          transitionDuration: `${motionMs}ms`,
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
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
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={contextTitle ? `${titleId} ${contextId}` : titleId}
          className={[
            "pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden",
            "origin-center bg-surface-container-high shadow-modal transition-[opacity,transform] motion-reduce:!transition-none",
            "rounded-none",
            "sm:h-[calc(100vh-48px)] sm:max-h-[calc(100vh-48px)] sm:w-[calc(100vw-72px)] sm:max-w-[calc(100vw-72px)] sm:rounded-2xl",
          ].join(" ")}
          style={panelMotion}
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
