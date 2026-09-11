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
    ["ram_on_close_only", "session_ram"],
    ["disk_close", "disk_close"],
    ["disk_open_close", "disk_open_close"],
  ] as const)("maps persisted %s → UI %s", (persisted, ui) => {
    expect(securityModeToUi(persisted)).toBe(ui);
  });

  it.each([
    ["session_ram", "session_ram"],
    ["prompt_open_close", "always_prompt"],
    ["disk_close", "disk_close"],
    ["disk_open_close", "disk_open_close"],
  ] as const)("maps UI %s → persisted %s", (ui, persisted) => {
    expect(uiToSecurityMode(ui)).toBe(persisted);
  });
});

describe("normalizeSecurityModeForStorage", () => {
  it("preserves security mode across all storage modes (PRD §4)", () => {
    expect(normalizeSecurityModeForStorage("encrypted_dir", "session_ram")).toBe("session_ram");
    expect(normalizeSecurityModeForStorage("upriv_plain", "always_prompt")).toBe("always_prompt");
    expect(normalizeSecurityModeForStorage("encrypted_dir", "disk_close")).toBe("disk_close");
    expect(normalizeSecurityModeForStorage("upriv_plain", "disk_open_close")).toBe(
      "disk_open_close",
    );
    expect(normalizeSecurityModeForStorage("encrypted_dir", "ram_on_close_only")).toBe(
      "session_ram",
    );
  });
});

describe("securityUiModesForStorage", () => {
  it("shows all four options for every storage mode", () => {
    for (const mode of ["encrypted_dir", "upriv_plain"] as const) {
      expect(securityUiModesForStorage(mode)).toEqual([
        "session_ram",
        "prompt_open_close",
        "disk_close",
        "disk_open_close",
      ]);
    }
  });
});
