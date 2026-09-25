import { describe, expect, it } from "vitest";
import {
  LOADING_APPEAR_DELAY_MS,
  LOADING_BUDGET_MS,
  LOADING_LONG_HINT_APPEAR_DELAY_MS,
  formatLoadingRemaining,
  loadingAppearDelayMs,
  loadingBudgetMinutes,
  loadingBudgetSeconds,
  loadingBudgetUsesMinutes,
} from "../budget";

describe("LOADING_BUDGET_MS", () => {
  it("keeps resolve shorter than setup", () => {
    expect(LOADING_BUDGET_MS.vaultRootResolve).toBeLessThan(LOADING_BUDGET_MS.vaultRoot);
    expect(LOADING_BUDGET_MS.vaultRoot).toBe(600_000);
    expect(LOADING_BUDGET_MS.vaultRootResolve).toBe(60_000);
    expect(LOADING_BUDGET_MS.vaultCreate).toBe(LOADING_BUDGET_MS.vaultRewrap);
    expect(LOADING_BUDGET_MS.vaultPipeline).toBe(LOADING_BUDGET_MS.vaultRewrap);
    expect(LOADING_BUDGET_MS.vaultExport).toBe(LOADING_BUDGET_MS.vaultRewrap);
    expect(LOADING_BUDGET_MS.vaultFsImport).toBe(LOADING_BUDGET_MS.vaultExport);
    expect(LOADING_BUDGET_MS.settingsSave).toBe(30_000);
    expect(LOADING_BUDGET_MS.vaultDelete).toBe(LOADING_BUDGET_MS.vaultRoot);
    expect(LOADING_BUDGET_MS.settingsSave).toBeLessThan(LOADING_BUDGET_MS.default);
    expect(LOADING_BUDGET_MS.vaultRename).toBe(LOADING_BUDGET_MS.default);
  });
});

describe("formatLoadingRemaining", () => {
  it("formats mm:ss without going negative", () => {
    expect(formatLoadingRemaining(90_000)).toBe("1:30");
    expect(formatLoadingRemaining(0)).toBe("0:00");
    expect(formatLoadingRemaining(-1)).toBe("0:00");
  });
});

describe("loading budget copy helpers", () => {
  it("uses minutes at or above 60s", () => {
    expect(loadingBudgetUsesMinutes(60_000)).toBe(true);
    expect(loadingBudgetUsesMinutes(59_999)).toBe(false);
    expect(loadingBudgetMinutes(600_000)).toBe("10");
    expect(loadingBudgetSeconds(1_000)).toBe("1");
  });

  it("holds the 10-minute hint for 10s, shorter budgets for 1s", () => {
    expect(loadingAppearDelayMs(LOADING_BUDGET_MS.vaultPipeline)).toBe(
      LOADING_LONG_HINT_APPEAR_DELAY_MS,
    );
    expect(loadingAppearDelayMs(LOADING_BUDGET_MS.vaultFsImport)).toBe(
      LOADING_LONG_HINT_APPEAR_DELAY_MS,
    );
    expect(loadingAppearDelayMs(LOADING_BUDGET_MS.settingsSave)).toBe(LOADING_APPEAR_DELAY_MS);
  });
});
