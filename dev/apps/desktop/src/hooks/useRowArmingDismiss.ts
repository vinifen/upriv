import { useEffect } from "react";
import { disarmRowButton, useArmedRowButton } from "@upriv/shared/react";

/** Marks the element whose presses belong to an armed row button (the row and its button). */
export const ROW_ARM_ATTR = "data-row-arm";

/**
 * Put an armed row button back to normal on a press anywhere else, a scroll,
 * Escape, or the window losing focus. Listens only while a button is armed.
 */
export function useRowArmingDismiss(): void {
  const armed = useArmedRowButton();

  useEffect(() => {
    if (armed === null) return;
    const ownPress = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(`[${ROW_ARM_ATTR}]`)?.getAttribute(ROW_ARM_ATTR) === armed;
    const onPointerDown = (event: PointerEvent) => {
      if (!ownPress(event.target)) disarmRowButton();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") disarmRowButton();
    };
    const onLeave = () => disarmRowButton();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onLeave, true);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onLeave, true);
      window.removeEventListener("blur", onLeave);
    };
  }, [armed]);
}
