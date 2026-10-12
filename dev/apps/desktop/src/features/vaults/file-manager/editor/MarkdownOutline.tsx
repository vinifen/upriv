import { useEffect, useMemo, useRef } from "react";
import { markdownOutline, type MarkdownOutlineEntry } from "@upriv/shared";
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
  markdown,
  onSelect,
}: {
  markdown: string;
  onSelect: (index: number, entry: MarkdownOutlineEntry) => void;
}) {
  const { t } = useTranslation();
  const outline = useMemo(() => markdownOutline(markdown), [markdown]);
  const entries = outline.entries;
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);

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
      <p className="shrink-0 px-3 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-widest text-on-surface-variant">
        {t("modal.file_manager.markdown.outline")}
      </p>
      {outline.status === "unparsed" ? (
        <p className="px-3 text-xs text-on-surface-variant">
          {t("modal.file_manager.markdown.outline_unparsed")}
        </p>
      ) : entries.length === 0 ? (
        <p className="px-3 text-xs text-on-surface-variant">
          {t("modal.file_manager.markdown.outline_empty")}
        </p>
      ) : (
        <nav ref={navRef} className="min-h-0 flex-1 overflow-auto pb-2">
          {/* w-max: long titles widen the list (horizontal scroll) instead of truncating. */}
          <ul className="w-max min-w-full">
            {entries.map((entry, index) => (
              <li key={`${index}-${entry.offset}`}>
                <button
                  type="button"
                  title={entry.text}
                  onClick={() => onSelect(index, entry)}
                  style={{ paddingLeft: `${0.75 + entry.level * 0.75}rem` }}
                  className={[
                    "block w-full whitespace-nowrap py-0.5 pr-3 text-left text-xs leading-5 transition-colors",
                    "hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    entry.level === 0 ? "font-medium text-on-surface" : "text-on-surface-variant",
                  ].join(" ")}
                >
                  {/* Sideways scroll for indent + normal titles; very long titles still truncate. */}
                  <span className="block max-w-[16rem] truncate">{entry.text || "…"}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </aside>
  );
}
