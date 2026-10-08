import { describe, expect, it } from "vitest";
import { fileTabMenuAction, fileTabMenuItems } from "../tabMenu";

const ids = (tabs: string[], pending = false) =>
  fileTabMenuItems(tabs, { pending }).map((item) => item.id);

describe("fileTabMenuItems", () => {
  it("offers close, close others, close all, rename, and delete", () => {
    expect(ids(["/a.md", "/b.md"])).toEqual([
      "close",
      "close_others",
      "close_all",
      "rename",
      "delete",
    ]);
  });

  it("hides the bulk close items when only one tab is open", () => {
    expect(ids(["/a.md"])).toEqual(["close", "rename", "delete"]);
  });

  it("hides rename and delete for a pending import", () => {
    expect(ids(["/a.md", "/b.md"], true)).toEqual(["close", "close_others", "close_all"]);
  });
});

describe("fileTabMenuAction", () => {
  const tabs = ["/a.md", "/b.md", "/c.md"];

  it("maps close items to close requests", () => {
    expect(fileTabMenuAction(tabs, "/b.md", "close")).toEqual({
      type: "request_close_tab",
      path: "/b.md",
    });
    expect(fileTabMenuAction(tabs, "/b.md", "close_others")).toEqual({
      type: "request_close_tabs",
      paths: ["/a.md", "/c.md"],
    });
    expect(fileTabMenuAction(tabs, "/b.md", "close_all")).toEqual({
      type: "request_close_tabs",
      paths: tabs,
    });
  });

  it("maps rename to the explorer inline rename", () => {
    expect(fileTabMenuAction(tabs, "/b.md", "rename")).toEqual({
      type: "start_rename",
      path: "/b.md",
    });
  });
});
