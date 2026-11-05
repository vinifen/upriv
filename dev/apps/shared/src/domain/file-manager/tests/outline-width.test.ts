import { describe, expect, it } from "vitest";
import {
  OUTLINE_WIDTH_MAX_PX,
  OUTLINE_WIDTH_MIN_PX,
  clampOutlineWidth,
  displayOutlineWidth,
  isOutlineDragCollapsed,
  outlineWidthFromDrag,
  persistableOutlineWidth,
} from "../outlineWidth";
import { vaultWorkspaceReducer } from "../workspaceReducer";
import { createDefaultWorkspaceState, fileMarkdownOutlineWidth } from "../workspaceTypes";

describe("outline width", () => {
  it("keeps a saved width within its range, rounded", () => {
    expect(clampOutlineWidth(20)).toBe(OUTLINE_WIDTH_MIN_PX);
    expect(clampOutlineWidth(5_000)).toBe(OUTLINE_WIDTH_MAX_PX);
    expect(persistableOutlineWidth(200.6)).toBe(201);
  });

  it("never draws wider than the row allows", () => {
    expect(displayOutlineWidth(500, 600)).toBe(360);
    expect(displayOutlineWidth(500, 0)).toBe(500);
    expect(displayOutlineWidth(500, 100)).toBe(OUTLINE_WIDTH_MIN_PX);
  });

  it("widens when the divider moves left and narrows when it moves right", () => {
    expect(outlineWidthFromDrag(200, -40, 1_000)).toBe(240);
    expect(outlineWidthFromDrag(200, 40, 1_000)).toBe(160);
    expect(outlineWidthFromDrag(200, 150, 1_000)).toBe(OUTLINE_WIDTH_MIN_PX);
  });

  it("closes once the divider passes half the minimum width from the edge", () => {
    expect(isOutlineDragCollapsed(200, 200 - OUTLINE_WIDTH_MIN_PX / 2)).toBe(true);
    expect(isOutlineDragCollapsed(200, 100)).toBe(false);
  });

  it("is saved per file, rounded and clamped", () => {
    const state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "set_file_markdown_outline_width",
      path: "/a.md",
      width: 233.7,
    });
    expect(fileMarkdownOutlineWidth(state, "/a.md")).toBe(234);
    expect(fileMarkdownOutlineWidth(state, "/b.md")).toBeNull();
  });
});
