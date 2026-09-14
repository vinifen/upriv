import { describe, expect, it } from "vitest";
import { MIN_CLOSING_DISPLAY_MS, remainingClosingDisplayMs } from "../closingDisplay";

describe("remainingClosingDisplayMs", () => {
  const startedAt = 1_000;
  const elapsed = 500;

  it("holds the full floor when close just started", () => {
    expect(remainingClosingDisplayMs(startedAt, startedAt)).toBe(MIN_CLOSING_DISPLAY_MS);
  });

  it("returns the leftover when some time already elapsed", () => {
    expect(remainingClosingDisplayMs(startedAt, startedAt + elapsed)).toBe(
      MIN_CLOSING_DISPLAY_MS - elapsed,
    );
  });

  it("is zero once the floor has elapsed", () => {
    expect(remainingClosingDisplayMs(startedAt, startedAt + MIN_CLOSING_DISPLAY_MS)).toBe(0);
    expect(remainingClosingDisplayMs(startedAt, startedAt + MIN_CLOSING_DISPLAY_MS + 1_000)).toBe(
      0,
    );
  });
});
