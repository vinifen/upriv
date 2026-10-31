import { describe, expect, it } from "vitest";
import { closeNowApplies, closeNowNeedsConfirm, closeNowNoticeKeys } from "../closeNow";

describe("closeNowNoticeKeys", () => {
  it("says the folder is not wiped only on a plaintext vault", () => {
    expect(closeNowNoticeKeys(true)).toContain("modal.close_now.not_wiped");
    expect(closeNowNoticeKeys(false)).not.toContain("modal.close_now.not_wiped");
  });

  it("names the skipped backup and the lost changes on both", () => {
    expect(closeNowNoticeKeys(false)).toContain("modal.close_now.no_backup");
    expect(closeNowNoticeKeys(false)).toContain("modal.close_now.changes_lost");
    expect(closeNowNoticeKeys(true)).toContain("modal.close_now.no_backup");
    expect(closeNowNoticeKeys(true)).toContain("modal.close_now.changes_lost_plain");
  });
});

describe("closeNowApplies", () => {
  it("covers an open vault and a running close", () => {
    expect(closeNowApplies("open")).toBe(true);
    expect(closeNowApplies("closing")).toBe(true);
  });

  it("leaves a closed vault alone", () => {
    expect(closeNowApplies("closed")).toBe(false);
    expect(closeNowApplies("recovery")).toBe(false);
  });
});

describe("closeNowNeedsConfirm", () => {
  it("asks while the setting is on", () => {
    expect(closeNowNeedsConfirm(true, false)).toBe(true);
    expect(closeNowNeedsConfirm(true, true)).toBe(true);
  });

  it("asks about an unsaved tab with the setting off", () => {
    expect(closeNowNeedsConfirm(false, true)).toBe(true);
  });

  it("runs straight away with the setting off and nothing unsaved", () => {
    expect(closeNowNeedsConfirm(false, false)).toBe(false);
  });
});
