import { describe, expect, it } from "vitest";
import { renameBasenameSelection } from "../renameSelection";

describe("renameBasenameSelection", () => {
  it("selects the basename before the last extension", () => {
    expect(renameBasenameSelection("texto.txt")).toEqual({ start: 0, end: 5 });
    expect(renameBasenameSelection("archive.tar.gz")).toEqual({ start: 0, end: 11 });
  });

  it("selects the whole name when there is no extension", () => {
    expect(renameBasenameSelection("notes")).toEqual({ start: 0, end: 5 });
    expect(renameBasenameSelection(".env")).toEqual({ start: 0, end: 4 });
  });
});
