import { describe, expect, it } from "vitest";
import { NO_DEADLINE_MS, OPERATION_LIMIT_MS, formatElapsed } from "..";

describe("limits", () => {
  it("has one limit, and no deadline is zero", () => {
    expect(OPERATION_LIMIT_MS).toBe(600_000);
    expect(NO_DEADLINE_MS).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("shows minutes and seconds under an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(61_000)).toBe("1:01");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("adds hours from one hour on", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_600_000 + 5 * 60_000 + 7_000)).toBe("1:05:07");
  });

  it("never goes negative", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});
