import { useEffect, useRef } from "react";
import type { MarkdownOutlineEntry, MarkdownOutlineModel } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { createSmoothScroller, type SmoothScroller, wheelDeltaPx } from "@/lib/smoothWheelScroll";

/** Path-bar button beside Code / Read: shows or hides the heading outline. */
export function MarkdownOutlineToggle({
  open,
  onChange,
}: {
  open: boolean;
  onChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = t(
    open ? "modal.file_manager.markdown.outline_hide" : "modal.file_manager.markdown.outline_show",
  );
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={() => onChange(!open)}
      className={[
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        open
          ? "bg-surface-container-highest text-on-surface"
          : "text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface",
      ].join(" ")}
    >
      <Icon name="outline" size={14} />
    </button>
  );
}

/** Right-hand map of the note's headings, indented by nesting. Click jumps to the heading. */
export function MarkdownOutlinePanel({
  outline,
  activeIndex = 0,
  onSelect,
}: {
  /** `markdownOutline` of the open note. */
  outline: MarkdownOutlineModel;
  activeIndex?: number;
  onSelect: (index: number, entry: MarkdownOutlineEntry) => void;
}) {
  const { t } = useTranslation();
  const entries = outline.entries;
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);

  /* Keep the current heading in view as it changes. */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || nav.scrollHeight <= nav.clientHeight) return;
    const activeEl = nav.querySelector<HTMLElement>('[aria-current="location"]');
    activeEl?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  /* Wheel anywhere on the panel (title included) scrolls the list; with nothing to scroll
     vertically, a plain wheel scrolls sideways (same idea as the tab strip). */
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    let scroller: { nav: HTMLElement; api: SmoothScroller } | null = null;
    const onWheel = (event: WheelEvent) => {
      const nav = navRef.current;
      if (!nav) return;
      if (scroller?.nav !== nav) {
        scroller?.api.dispose();
        scroller = { nav, api: createSmoothScroller(nav) };
      }
      const { x, y } = wheelDeltaPx(event, nav);
      if (nav.scrollHeight > nav.clientHeight) {
        if (nav.contains(event.target as Node)) return;
        if (scroller.api.scrollBy(x, y)) event.preventDefault();
        return;
      }
      if (nav.scrollWidth <= nav.clientWidth) return;
      const delta = Math.abs(x) > Math.abs(y) ? x : y;
      if (delta !== 0 && scroller.api.scrollBy(delta, 0)) event.preventDefault();
    };
    aside.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      aside.removeEventListener("wheel", onWheel);
      scroller?.api.dispose();
    };
  }, []);

  return (
    <aside
      ref={asideRef}
      aria-label={t("modal.file_manager.markdown.outline")}
      className="flex w-[10.25rem] min-w-0 md:w-[11.5rem] max-w-[40%] shrink-0 flex-col border-l border-outline-variant/40 bg-surface-container-high"
    >
      {outline.status === "unparsed" ? (
        <p className="px-3 py-2 text-xs text-on-surface-variant">
          {t("modal.file_manager.markdown.outline_unparsed")}
        </p>
      ) : entries.length === 0 ? (
        <p className="px-3 py-2 text-xs text-on-surface-variant">
          {t("modal.file_manager.markdown.outline_empty")}
        </p>
      ) : (
        <nav ref={navRef} className="min-h-0 flex-1 overflow-auto py-1">
          {/* w-max: indented titles widen the list (horizontal scroll); each title truncates at 16rem. */}
          <ul className="w-max min-w-full">
            {entries.map((entry, index) => {
              const isActive = activeIndex === index;
              return (
                <li key={`${index}-${entry.offset}`}>
                  <button
                    type="button"
                    title={entry.text}
                    onClick={() => onSelect(index, entry)}
                    aria-current={isActive ? "location" : undefined}
                    style={{ paddingLeft: `${0.75 + entry.level * 0.75}rem` }}
                    className={[
                      "block w-full whitespace-nowrap py-0.5 pr-3 text-left text-xs leading-5 border-l-2 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                      isActive
                        ? "border-accent bg-accent/10 font-medium text-accent hover:bg-accent/15"
                        : [
                            "border-transparent hover:bg-surface-container-highest hover:text-on-surface",
                            entry.level === 0
                              ? "font-medium text-on-surface"
                              : "text-on-surface-variant",
                          ].join(" "),
                    ].join(" ")}
                  >
                    <span className="block max-w-[16rem] truncate">{entry.text || "…"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </aside>
  );
}
