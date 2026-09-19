import { describe, expect, it } from "vitest";
import { MODAL_CLOSE_MS } from "../../motion";
import {
  acquireOpenModal,
  hasOpenModal,
  releaseOpenModal,
  scheduleOpenFileManagerIfIdle,
} from "../presence";

function settle(extraMs = 100): Promise<void> {
  return new Promise((resolve) => {
    const timers = globalThis as { setTimeout?: (fn: () => void, delay: number) => number };
    timers.setTimeout?.(() => resolve(), MODAL_CLOSE_MS + extraMs);
  });
}

describe("modal presence", () => {
  it("tracks open overlays", () => {
    while (hasOpenModal()) releaseOpenModal();
    expect(hasOpenModal()).toBe(false);
    acquireOpenModal();
    expect(hasOpenModal()).toBe(true);
    acquireOpenModal();
    releaseOpenModal();
    expect(hasOpenModal()).toBe(true);
    releaseOpenModal();
    expect(hasOpenModal()).toBe(false);
  });

  it("skips auto-open when a modal is present", async () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    acquireOpenModal();
    scheduleOpenFileManagerIfIdle(true, () => {
      opened = true;
    });
    await settle();
    expect(opened).toBe(false);
    releaseOpenModal();
  });

  it("auto-opens when idle and enabled", async () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    scheduleOpenFileManagerIfIdle(true, () => {
      opened = true;
    });
    await settle();
    expect(opened).toBe(true);
  });

  it("does nothing when disabled", async () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    scheduleOpenFileManagerIfIdle(false, () => {
      opened = true;
    });
    await settle();
    expect(opened).toBe(false);
  });

  it("opens after a closing overlay unmounts just after the close budget", async () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    acquireOpenModal();
    scheduleOpenFileManagerIfIdle(true, () => {
      opened = true;
    });
    await new Promise<void>((resolve) => {
      const timers = globalThis as { setTimeout?: (fn: () => void, delay: number) => number };
      timers.setTimeout?.(() => {
        releaseOpenModal();
        resolve();
      }, MODAL_CLOSE_MS + 16);
    });
    await settle();
    expect(opened).toBe(true);
  });
});
