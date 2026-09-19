import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import {
  MODAL_CLOSE_MS,
  MODAL_OPEN_MS,
  MODAL_SCALE_FROM,
  acquireOpenModal,
  releaseOpenModal,
} from "@upriv/shared";
import { acquireScrollLock, releaseScrollLock } from "./scrollLock";

const modalChromeButtonClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-on-surface hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Header chrome control (close, minimize) — icon-sized, no text-button font strut. */
export function ModalChromeButton({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={[modalChromeButtonClass, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export interface ModalTitleClusterProps {
  titleId: string;
  contextId: string;
  title: string;
  contextTitle?: string;
  titleIcon?: IconName;
  compact?: boolean;
}

/** Icon + action title, then vault/group name on the same baseline. */
export function ModalTitleCluster({
  titleId,
  contextId,
  title,
  contextTitle,
  titleIcon,
  compact = false,
}: ModalTitleClusterProps) {
  const typeClass = compact
    ? "font-display text-sm leading-none sm:text-base"
    : "font-display text-base leading-none sm:text-xl";
  const contextClass = compact
    ? "font-display text-xs leading-none text-on-surface-variant sm:text-sm"
    : "font-display text-sm leading-none text-on-surface-variant sm:text-base";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {titleIcon ? (
        <Icon
          name={titleIcon}
          size={compact ? 15 : 16}
          className="block shrink-0 text-on-surface-variant"
          aria-hidden
        />
      ) : null}
      <div className="flex min-w-0 items-baseline gap-2">
        <h2
          id={titleId}
          className={[
            typeClass,
            "font-semibold text-on-surface",
            contextTitle ? "shrink-0" : "min-w-0 truncate",
          ].join(" ")}
        >
          {title}
        </h2>
        {contextTitle ? (
          <>
            <span className={["shrink-0", contextClass].join(" ")} aria-hidden>
              —
            </span>
            <p id={contextId} className={["min-w-0 truncate font-normal", contextClass].join(" ")}>
              {contextTitle}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export interface ModalProps {
  open: boolean;
  title: string;
  /** Shown to the right of `title` (vault or group display name). */
  contextTitle?: string;
  titleIcon?: IconName;
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
  /**
   * When false, children are not wrapped in a scroll pane — caller owns scroll
   * (e.g. create-vault sticky step nav + scrollable step body). Mobile `bodyScroll` parity.
   */
  bodyScroll?: boolean;
  /** Smaller title cluster — File Manager / short dialogs. */
  compact?: boolean;
}

export function Modal({
  open,
  title,
  contextTitle,
  titleIcon,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = "max-w-lg",
  rootClassName = "z-[100]",
  dismissible = true,
  bodyScroll = true,
  compact = false,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const contextId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const scrimStart = useRef<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

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

  // Reveal after the portal has painted at opacity 0 (avoids skipping the enter tween).
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
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dismissible]);

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

  // Focus trap while open. Delay initial focus until the enter tween finishes
  // so large dialogs (create vault) are not interrupted mid-animation.
  // Do not steal focus if a child already took it (e.g. PasswordInput autoFocus).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );

    const focusTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel.contains(active) && active !== panel) {
        return;
      }
      panel.focus({ preventScroll: true });
    }, MODAL_OPEN_MS);

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
    // Ignore focus moving into another portaled UI (Select listbox).
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
      window.clearTimeout(focusTimer);
      panel.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, [open, mounted]);

  const scrollFooterLayout = Boolean(footer);

  if (!mounted) return null;

  const bodyClass = bodyScroll
    ? "modal-scroll-pane min-h-0 text-body text-on-surface overflow-y-auto"
    : [
        "flex min-h-0 flex-col text-body text-on-surface overflow-hidden",
        scrollFooterLayout ? "min-h-0" : "",
      ]
        .filter(Boolean)
        .join(" ");

  const motionMs = visible ? MODAL_OPEN_MS : MODAL_CLOSE_MS;
  const motionStyle: CSSProperties = {
    transitionDuration: `${motionMs}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    transform: visible ? "scale(1)" : `scale(${MODAL_SCALE_FROM})`,
    willChange: "opacity, transform",
  };

  return createPortal(
    <div className={["fixed inset-0 overscroll-none", rootClassName].join(" ")}>
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
          dismissible
            ? (event) => {
                scrimStart.current = { x: event.clientX, y: event.clientY };
              }
            : undefined
        }
        onClick={
          dismissible
            ? (event) => {
                const start = scrimStart.current;
                scrimStart.current = null;
                if (!start) {
                  onClose();
                  return;
                }
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (dx * dx + dy * dy <= 100) onClose();
              }
            : undefined
        }
      />
      <div className="pointer-events-none relative z-10 flex min-h-full items-center justify-center p-3 sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={contextTitle ? `${titleId} ${contextId}` : titleId}
          tabIndex={-1}
          className={[
            // Keep in sync with mobile `MODAL_MAX_HEIGHT_RATIO` (~0.88 of viewport).
            "pointer-events-auto flex h-fit w-full max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden bg-surface-container-high shadow-modal",
            "rounded-2xl",
            "p-4 sm:p-6",
            "outline-none",
            "origin-center transition-[opacity,transform] motion-reduce:!transition-none",
            visible ? "opacity-100" : "opacity-0",
            scrollFooterLayout ? "min-h-0 sm:max-h-[min(88vh,calc(100vh-2.5rem))]" : "",
            panelClassName,
          ].join(" ")}
          style={motionStyle}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header
            className={
              compact
                ? "mb-3 flex min-h-10 shrink-0 items-center justify-between gap-2 pb-2 sm:mb-4"
                : "mb-4 flex min-h-11 shrink-0 items-center justify-between gap-2 pt-1.5 pb-2.5 sm:mb-5 sm:min-h-12 sm:gap-4 sm:pt-2 sm:pb-3"
            }
          >
            <ModalTitleCluster
              titleId={titleId}
              contextId={contextId}
              title={title}
              contextTitle={contextTitle}
              titleIcon={titleIcon}
              compact={compact}
            />
            <div className="flex shrink-0 items-center self-center gap-1">
              {headerActions}
              {dismissible ? (
                <ModalChromeButton onClick={onClose} aria-label={t("action.close")}>
                  <Icon name="close" size={18} className="block" />
                </ModalChromeButton>
              ) : null}
            </div>
          </header>
          <div className={bodyClass}>{children}</div>
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
