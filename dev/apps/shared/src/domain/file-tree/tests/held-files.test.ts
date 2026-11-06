import { describe, expect, it } from "vitest";
import { heldFileStanding, heldSummary, parseHeldItems, type HeldItem } from "../heldFiles";

const piece = (name: string, size: number): HeldItem => ({ name, size, heldAt: 1, file: null });
const held = (name: string, modifiedAt: number, currentModifiedAt: number | null): HeldItem => ({
  name,
  size: 100,
  heldAt: 1,
  file: { path: `/docs/${name}.txt`, size: 10, modifiedAt, currentModifiedAt },
});

describe("parseHeldItems", () => {
  it("reads files and pieces and leaves out what it cannot read", () => {
    const items = parseHeldItems({
      items: [
        {
          name: "a.blob",
          size: 300,
          heldAt: 9,
          file: { path: "/a.txt", size: 6, modifiedAt: 4, currentModifiedAt: 8 },
        },
        { name: "b.blob", size: 64, heldAt: 9, file: null },
        { name: "c.blob", size: 64, heldAt: 9, file: { path: "", size: 1, modifiedAt: 1 } },
        { name: "", size: 1, heldAt: 1 },
        { name: "d.blob", size: -1, heldAt: 1 },
        "e.blob",
      ],
    });
    expect(items).toEqual([
      {
        name: "a.blob",
        size: 300,
        heldAt: 9,
        file: { path: "/a.txt", size: 6, modifiedAt: 4, currentModifiedAt: 8 },
      },
      { name: "b.blob", size: 64, heldAt: 9, file: null },
      { name: "c.blob", size: 64, heldAt: 9, file: null },
    ]);
  });

  it("is empty for an answer without items", () => {
    expect(parseHeldItems(null)).toEqual([]);
    expect(parseHeldItems({ items: "x" })).toEqual([]);
  });
});

describe("heldSummary", () => {
  it("is null while nothing is set aside", () => {
    expect(heldSummary([])).toBeNull();
  });

  it("splits files from pieces and adds up the pieces", () => {
    const summary = heldSummary([held("a", 2, null), piece("p", 64), piece("q", 36)]);
    expect(summary?.files.map((item) => item.name)).toEqual(["a"]);
    expect(summary?.pieces.map((item) => item.name)).toEqual(["p", "q"]);
    expect(summary?.pieceBytes).toBe(100);
  });
});

describe("heldFileStanding", () => {
  it("compares the held copy with the file at its path now", () => {
    expect(heldFileStanding(held("a", 5, null).file!)).toBe("absent");
    expect(heldFileStanding(held("a", 5, 4).file!)).toBe("newer");
    expect(heldFileStanding(held("a", 5, 5).file!)).toBe("same_time");
    expect(heldFileStanding(held("a", 5, 9).file!)).toBe("older");
  });
});
