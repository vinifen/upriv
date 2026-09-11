/** Nested overlays share one document scroll lock. Page scroll lives on `html`, not `body`. */

let lockCount = 0;
let savedHtmlOverflow = "";
let savedBodyOverflow = "";
let savedHtmlOverscroll = "";

function canScrollY(el: HTMLElement, deltaY: number): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  if (deltaY < 0) return el.scrollTop > 0;
  if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  return true;
}

function wheelStaysInOverlay(event: WheelEvent): boolean {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && canScrollY(node, event.deltaY)) return true;
  }
  return false;
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey) return;
  if (wheelStaysInOverlay(event)) return;
  event.preventDefault();
}

function onTouchMove(event: TouchEvent) {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (canScrollY(node, 1) || canScrollY(node, -1)) return;
  }
  event.preventDefault();
}

/** Freeze the vault list / page behind a modal. Call `releaseScrollLock` on close. */
export function acquireScrollLock() {
  if (lockCount === 0 && typeof document !== "undefined") {
    const html = document.documentElement;
    savedHtmlOverflow = html.style.overflow;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverscroll = html.style.overscrollBehavior;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
  }
  lockCount += 1;
}

export function releaseScrollLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0 || typeof document === "undefined") return;
  const html = document.documentElement;
  html.style.overflow = savedHtmlOverflow;
  document.body.style.overflow = savedBodyOverflow;
  html.style.overscrollBehavior = savedHtmlOverscroll;
  document.removeEventListener("wheel", onWheel, { capture: true });
  document.removeEventListener("touchmove", onTouchMove, { capture: true });
}
