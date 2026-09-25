import { describe, expect, it } from "vitest";
import { parseGdbusStringArray } from "../portalFileTransfer";

describe("parseGdbusStringArray", () => {
  it("parses RetrieveFiles stdout", () => {
    expect(parseGdbusStringArray("(['/tmp/a.txt', '/tmp/photos'],)\n")).toEqual([
      "/tmp/a.txt",
      "/tmp/photos",
    ]);
  });

  it("returns empty for an empty array", () => {
    expect(parseGdbusStringArray("(@as [],)\n")).toEqual([]);
  });
});
