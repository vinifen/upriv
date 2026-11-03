import { useCallback, useEffect } from "react";
import { AppState, BackHandler } from "react-native";
import { disarmRowButton, useArmedRowButton } from "@upriv/shared/react";

/** The row whose touch is on its way up to the screen; its own taps keep it armed. */
let rowTouch: string | null = null;

/** A row marks its touches (`onTouchStart`), which reach the screen after it. */
export function claimRowArmTouch(vaultId: string): void {
  rowTouch = vaultId;
}

/**
 * Put an armed row button back to normal on Android back (it takes the press
 * before anything else), a tap anywhere else, a scroll, or the app leaving the
 * foreground. The screen spreads `onTouchStart` on its root view and
 * `onScrollBeginDrag` on its list.
 */
export function useRowArmingDismiss() {
  const armed = useArmedRowButton();

  useEffect(() => {
    if (armed === null) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => disarmRowButton());
    const app = AppState.addEventListener("change", (state) => {
      if (state !== "active") disarmRowButton();
    });
    return () => {
      back.remove();
      app.remove();
    };
  }, [armed]);

  const onTouchStart = useCallback(() => {
    const own = rowTouch;
    rowTouch = null;
    if (armed !== null && own !== armed) disarmRowButton();
  }, [armed]);

  const onScrollBeginDrag = useCallback(() => {
    disarmRowButton();
  }, []);

  return { onTouchStart, onScrollBeginDrag };
}
