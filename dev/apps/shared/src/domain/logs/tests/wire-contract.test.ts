import { describe, expect, it } from "vitest";
import { parseAppLogFile } from "../parse";
import wireFixture from "./log-file-info.wire.json";

describe("log file wire contract", () => {
  it("parses the shared golden fixture", () => {
    const parsed = parseAppLogFile(wireFixture);
    expect(parsed).toMatchObject({
      filename: "current-000001-20260101120000.log",
      seq: 1,
      isCurrent: true,
      createdAt: "2026-01-01T12:00:00.000Z",
      sizeBytes: 42,
      lineCount: 3,
      lineCountExact: true,
      content: "",
    });
  });

  it("rejects invalid shapes", () => {
    expect(() => parseAppLogFile(null)).toThrow(/expected object/);
    expect(() => parseAppLogFile({ filename: "x.log" })).toThrow(/invalid shape/);
    expect(() =>
      parseAppLogFile({
        ...wireFixture,
        sizeBytes: -1,
      }),
    ).toThrow(/invalid shape/);
    expect(() =>
      parseAppLogFile({
        ...wireFixture,
        lineCount: -1,
      }),
    ).toThrow(/invalid shape/);
    expect(() =>
      parseAppLogFile({
        ...wireFixture,
        lineCount: 3.5,
      }),
    ).toThrow(/invalid shape/);
  });
});
