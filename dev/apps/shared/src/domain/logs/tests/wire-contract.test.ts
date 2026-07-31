import { describe, expect, it } from "vitest";
import { parseAppLogFile } from "../parse";
import wireFixture from "./log-file-info.wire.json";
import { logCreatedAtFromFilename } from "../format";

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
  });
});

describe("logCreatedAtFromFilename", () => {
  it("matches Rust stamp_to_iso (.000Z)", () => {
    expect(logCreatedAtFromFilename("current-000001-20260101120000.log")).toBe(
      "2026-01-01T12:00:00.000Z",
    );
    expect(logCreatedAtFromFilename("000002-20260529153045.log")).toBe(
      "2026-05-29T15:30:45.000Z",
    );
  });
});
