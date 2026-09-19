import { describe, expect, it } from "vitest";
import {
  DOCK_COLLAPSE_MS,
  DOCK_EXPAND_MS,
  DOCK_FADE_MS,
  FILE_MANAGER_LONG_PRESS_MS,
  FILE_MANAGER_LONG_PRESS_MOVE_PX,
  FILE_MANAGER_DROP_EXPAND_MS,
  FILE_MANAGER_PICKER_CACHE_WIPE_RETRY_MS,
  VAULT_LIST_DRAG_THRESHOLD_PX,
  GROUP_COLLAPSE_MS,
  GROUP_EXPAND_MS,
  MODAL_CLOSE_MS,
  MODAL_OPEN_MS,
  MODAL_SCALE_FROM,
} from "../timings";

describe("motion timings", () => {
  it("keeps modal open slower than close", () => {
    expect(MODAL_OPEN_MS).toBeGreaterThan(MODAL_CLOSE_MS);
    expect(MODAL_SCALE_FROM).toBeLessThan(1);
  });

  it("keeps group expand slower than collapse", () => {
    expect(GROUP_EXPAND_MS).toBeGreaterThanOrEqual(GROUP_COLLAPSE_MS);
  });

  it("keeps dock close at least as snappy as open", () => {
    expect(DOCK_EXPAND_MS).toBeGreaterThanOrEqual(DOCK_COLLAPSE_MS);
    expect(DOCK_COLLAPSE_MS).toBeLessThanOrEqual(GROUP_COLLAPSE_MS);
    expect(DOCK_FADE_MS).toBeLessThanOrEqual(DOCK_COLLAPSE_MS);
  });

  it("keeps file-manager long-press at the SDD 450ms gesture", () => {
    expect(FILE_MANAGER_LONG_PRESS_MS).toBe(450);
    expect(FILE_MANAGER_LONG_PRESS_MOVE_PX).toBe(6);
  });

  it("dwells before expanding a folder under a drop and retries picker-cache wipes", () => {
    expect(FILE_MANAGER_DROP_EXPAND_MS).toBe(400);
    expect(FILE_MANAGER_PICKER_CACHE_WIPE_RETRY_MS).toBe(8000);
  });

  it("requires vault-list grip movement before a drag starts", () => {
    expect(VAULT_LIST_DRAG_THRESHOLD_PX).toBe(8);
  });
});
