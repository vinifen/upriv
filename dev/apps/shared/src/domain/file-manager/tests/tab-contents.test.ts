import { describe, expect, it } from "vitest";
import {
  markTabRecent,
  tabContentsToLoad,
  tabsNeedingContent,
  trimTabContents,
  withSavedDrafts,
  withTabContent,
  type TabContents,
} from "../tabContents";

const loaded = (text: string, revision = 1) => ({ state: "loaded" as const, text, revision });

describe("tabsNeedingContent", () => {
  it("is the tab on screen and every unsaved tab, once each", () => {
    expect(tabsNeedingContent({ activeTabPath: "/a.md", dirtyPaths: ["/b.md"] })).toEqual([
      "/a.md",
      "/b.md",
    ]);
    expect(tabsNeedingContent({ activeTabPath: "/b.md", dirtyPaths: ["/b.md"] })).toEqual([
      "/b.md",
    ]);
    expect(tabsNeedingContent({ activeTabPath: null, dirtyPaths: [] })).toEqual([]);
  });
});

describe("tabContentsToLoad", () => {
  const contents: TabContents = {
    "/fresh.md": loaded("x", 4),
    "/stale.md": loaded("x", 3),
    "/failed.md": { state: "failed", revision: 3 },
    "/big.png": { state: "too_large", revision: 1 },
  };

  it("reads tabs never read and tabs read before the tree changed", () => {
    const needed = ["/fresh.md", "/stale.md", "/failed.md", "/new.md"];
    expect(tabContentsToLoad(contents, needed, 4, new Set())).toEqual([
      "/stale.md",
      "/failed.md",
      "/new.md",
    ]);
  });

  it("leaves a tab over the preview cap and a read already running", () => {
    expect(tabContentsToLoad(contents, ["/big.png", "/new.md"], 9, new Set(["/new.md"]))).toEqual(
      [],
    );
  });
});

describe("withTabContent", () => {
  it("keeps a newer read when an older one lands late", () => {
    const contents: TabContents = { "/a.md": loaded("new", 5) };
    expect(withTabContent(contents, "/a.md", loaded("old", 4))).toBe(contents);
    expect(withTabContent(contents, "/a.md", loaded("newer", 6))["/a.md"]).toEqual(
      loaded("newer", 6),
    );
  });
});

describe("trimTabContents", () => {
  const contents: TabContents = {
    "/active.md": loaded("a".repeat(50)),
    "/dirty.md": loaded("d".repeat(50)),
    "/recent.md": loaded("r".repeat(30)),
    "/older.md": loaded("o".repeat(30)),
    "/closed.md": loaded("c"),
  };

  it("keeps needed tabs, then the newest others within the budget, and drops closed tabs", () => {
    const next = trimTabContents(contents, {
      openTabs: ["/active.md", "/dirty.md", "/recent.md", "/older.md"],
      needed: ["/active.md", "/dirty.md"],
      recent: ["/active.md", "/recent.md", "/older.md", "/dirty.md"],
      budgetChars: 40,
    });
    expect(Object.keys(next).sort()).toEqual(["/active.md", "/dirty.md", "/recent.md"]);
  });

  it("returns the same contents when nothing is dropped", () => {
    const open = Object.keys(contents);
    expect(
      trimTabContents(contents, {
        openTabs: open,
        needed: open,
        recent: [],
        budgetChars: 0,
      }),
    ).toBe(contents);
  });

  it("keeps a failed or oversized tab at no cost", () => {
    const marks: TabContents = {
      "/failed.md": { state: "failed", revision: 1 },
      "/big.png": { state: "too_large", revision: 1 },
    };
    expect(
      trimTabContents(marks, {
        openTabs: ["/failed.md", "/big.png"],
        needed: [],
        recent: ["/failed.md", "/big.png"],
        budgetChars: 0,
      }),
    ).toBe(marks);
  });
});

describe("markTabRecent", () => {
  it("moves the tab to the front once", () => {
    expect(markTabRecent(["/a", "/b", "/c"], "/c")).toEqual(["/c", "/a", "/b"]);
    expect(markTabRecent([], "/a")).toEqual(["/a"]);
  });
});

describe("withSavedDrafts", () => {
  it("puts a clean draft into a tab already read and leaves unsaved text alone", () => {
    const contents: TabContents = { "/old.md": loaded("old"), "/dirty.md": loaded("disk") };
    const next = withSavedDrafts(contents, {
      dirtyPaths: ["/dirty.md"],
      editorDrafts: { "/old.md": "saved", "/dirty.md": "typing", "/unread.md": "saved" },
    });

    expect(next).toEqual({ "/old.md": loaded("saved"), "/dirty.md": loaded("disk") });
  });

  it("returns the same contents when nothing clean changed", () => {
    const contents: TabContents = { "/a.md": loaded("a") };
    expect(
      withSavedDrafts(contents, { dirtyPaths: ["/a.md"], editorDrafts: { "/a.md": "typing" } }),
    ).toBe(contents);
  });
});
