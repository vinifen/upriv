import { describe, expect, it } from "vitest";
import { commitIntegerDraft, integerDraftValue, sanitizeIntegerDraft } from "../integerDraft";

describe("sanitizeIntegerDraft", () => {
  it("keeps digits only and allows an empty draft", () => {
    expect(sanitizeIntegerDraft("")).toBe("");
    expect(sanitizeIntegerDraft("12a3")).toBe("123");
    expect(sanitizeIntegerDraft("-5")).toBe("5");
    expect(sanitizeIntegerDraft("1.5")).toBe("15");
  });
});

describe("integerDraftValue", () => {
  it("returns in-range values only", () => {
    expect(integerDraftValue("", 0, 10)).toBeNull();
    expect(integerDraftValue("7", 0, 10)).toBe(7);
    expect(integerDraftValue("007", 0, 10)).toBe(7);
    expect(integerDraftValue("0", 1, 10)).toBeNull();
    expect(integerDraftValue("11", 0, 10)).toBeNull();
  });
});

describe("commitIntegerDraft", () => {
  it("turns an empty field into 0, clamped to the range", () => {
    expect(commitIntegerDraft("", 0, 300)).toBe(0);
    expect(commitIntegerDraft("", 1, 99)).toBe(1);
  });

  it("clamps typed values", () => {
    expect(commitIntegerDraft("150", 1, 99)).toBe(99);
    expect(commitIntegerDraft("0", 1, 1440)).toBe(1);
    expect(commitIntegerDraft("42", 0, 100)).toBe(42);
  });
});
