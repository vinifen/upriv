import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODAL_CLOSE_MS } from "../../motion";
import {
  acquireOpenModal,
  hasOpenModal,
  releaseOpenModal,
  scheduleOpenFileManagerIfIdle,
} from "../presence";

function settle(extraMs = 100): void {
  vi.advanceTimersByTime(MODAL_CLOSE_MS + extraMs);
}

describe("modal presence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("skips auto-open when a modal is present", () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    acquireOpenModal();
    scheduleOpenFileManagerIfIdle(true, () => {
      opened = true;
    });
    settle();
    expect(opened).toBe(false);
    releaseOpenModal();
  });

  it("auto-opens when idle and enabled", () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    scheduleOpenFileManagerIfIdle(true, () => {
      opened = true;
    });
    settle();
    expect(opened).toBe(true);
  });

  it("does nothing when disabled", () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    scheduleOpenFileManagerIfIdle(false, () => {
      opened = true;
    });
    settle();
    expect(opened).toBe(false);
  });

  it("opens after a closing overlay unmounts just after the close budget", () => {
    while (hasOpenModal()) releaseOpenModal();
    let opened = false;
    acquireOpenModal();
    scheduleOpenFileManagerIfIdle(true, () => {
      opened = true;
    });
    vi.advanceTimersByTime(MODAL_CLOSE_MS + 16);
    releaseOpenModal();
    settle();
    expect(opened).toBe(true);
  });
});
