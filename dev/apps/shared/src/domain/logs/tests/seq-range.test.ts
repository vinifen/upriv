import { describe, expect, it } from "vitest";
import { logSeqRange } from "../format";
import type { AppLogFile } from "../types";

function file(seq: number): AppLogFile {
  return {
    filename: `${String(seq).padStart(6, "0")}-20260929120000.log`,
    seq,
    isCurrent: false,
    createdAt: "2026-09-29T12:00:00.000Z",
    sizeBytes: 0,
    lineCount: 0,
    lineCountExact: true,
    content: "",
  };
}

describe("logSeqRange", () => {
  const files = [file(7), file(3), file(5), file(1)];

  it("spans the lowest and highest selected seq", () => {
    expect(logSeqRange(files, [files[0].filename, files[1].filename, files[2].filename])).toEqual({
      first: 3,
      last: 7,
    });
  });

  it("has no range when a selected file is missing from the list", () => {
    expect(logSeqRange(files, [files[3].filename, "gone.log"])).toBeNull();
    expect(logSeqRange(files, ["gone.log"])).toBeNull();
  });

  it("has no range when a selected file has no sequence number", () => {
    const odd = { ...file(0), filename: "000002-202609291350392.log" };
    expect(logSeqRange([...files, odd], [files[0].filename, odd.filename])).toBeNull();
  });
});
