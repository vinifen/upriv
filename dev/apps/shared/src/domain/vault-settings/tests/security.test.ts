import { describe, expect, it } from "vitest";
import {
  normalizeSecurityModeForStorage,
  securityModeToUi,
  securityUiModesForStorage,
  uiToSecurityMode,
} from "..";

describe("securityModeToUi / uiToSecurityMode", () => {
  it.each([
    ["session_ram", "session_ram"],
    ["always_prompt", "prompt_open_close"],
    ["ram_on_close_only", "prompt_open_close"],
    ["disk_close", "disk_close"],
    ["disk_open_close", "disk_open_close"],
  ] as const)("maps %s ↔ %s", (persisted, ui) => {
    expect(securityModeToUi(persisted)).toBe(ui);
    expect(uiToSecurityMode(ui)).toBe(
      ui === "prompt_open_close" ? "always_prompt" : persisted,
    );
  });
});

describe("normalizeSecurityModeForStorage", () => {
  it("preserves security mode across all storage modes (PRD §4)", () => {
    expect(normalizeSecurityModeForStorage("plain", "session_ram")).toBe("session_ram");
    expect(normalizeSecurityModeForStorage("plain_only", "always_prompt")).toBe("always_prompt");
    expect(normalizeSecurityModeForStorage("encrypted_dir", "disk_close")).toBe("disk_close");
    expect(normalizeSecurityModeForStorage("ram_only", "disk_open_close")).toBe("disk_open_close");
    expect(normalizeSecurityModeForStorage("store_only", "always_prompt")).toBe("always_prompt");
  });
});

describe("securityUiModesForStorage", () => {
  it("shows all four options for every storage mode", () => {
    for (const mode of ["encrypted_dir", "store_only", "ram_only", "plain", "plain_only"] as const) {
      expect(securityUiModesForStorage(mode)).toEqual([
        "session_ram",
        "prompt_open_close",
        "disk_close",
        "disk_open_close",
      ]);
    }
  });
});
