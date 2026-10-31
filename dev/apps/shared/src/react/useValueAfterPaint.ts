import { useEffect, useState } from "react";
import { scheduleAnimationFrame, scheduleTimeout } from "./schedule";

/**
 * `value` once the frame it changed in has painted, so a press shows on screen
 * before the heavy work for the new value starts. Quick changes settle on the
 * last one, and the values between them do no work.
 */
export function useValueAfterPaint<T>(value: T): T {
  const [painted, setPainted] = useState(value);

  useEffect(() => {
    if (Object.is(painted, value)) return;
    let cancelTimeout = () => {};
    // A frame callback runs before that frame paints; a timeout set in it runs after.
    const cancelFrame = scheduleAnimationFrame(() => {
      cancelTimeout = scheduleTimeout(() => setPainted(value), 0);
    });
    return () => {
      cancelFrame();
      cancelTimeout();
    };
  }, [painted, value]);

  return painted;
}
