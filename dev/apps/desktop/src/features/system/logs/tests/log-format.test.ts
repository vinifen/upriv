import { describe, expect, it } from "vitest";
import { logLevelClass } from "../logFormat";

describe("logLevelClass", () => {
  it.each([
    ["ERROR", "text-on-error-container"],
    ["WARN", "text-vault-recovery"],
    ["INFO", "text-accent"],
    ["DEBUG", "text-on-surface-variant"],
    ["TRACE", "text-on-surface-variant/70"],
  ] as const)("%s → %s", (level, expected) => {
    expect(logLevelClass(level)).toBe(expected);
  });
});
