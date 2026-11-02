import { describe, expect, it } from "vitest";
import {
  LOADING_BUDGET_MS,
  SIZED_BUDGET_CEILING_MS,
  SIZED_WORK,
  SLOW_DISK_BYTES_PER_SECOND,
  sizedBudgetMs,
} from "..";

const GIB = 1024 * 1024 * 1024;

describe("sizedBudgetMs", () => {
  it("is the floor until core has measured the work", () => {
    expect(sizedBudgetMs("vaultBackupSave", null)).toBe(LOADING_BUDGET_MS.vaultBackupSave);
    expect(sizedBudgetMs("vaultBackupSave", undefined)).toBe(LOADING_BUDGET_MS.vaultBackupSave);
    expect(sizedBudgetMs("vaultBackupSave", 0)).toBe(LOADING_BUDGET_MS.vaultBackupSave);
    expect(sizedBudgetMs("vaultBackupSave", Number.NaN)).toBe(LOADING_BUDGET_MS.vaultBackupSave);
  });

  it("adds every pass over the bytes at the slow disk speed", () => {
    const bytes = 4 * SLOW_DISK_BYTES_PER_SECOND;
    // Back up now reads, writes, and checks: three passes of 4 s each.
    expect(sizedBudgetMs("vaultBackupSave", bytes)).toBe(
      LOADING_BUDGET_MS.vaultBackupSave + 12_000,
    );
    // Removing a leftover folder overwrites and deletes: two passes.
    expect(sizedBudgetMs("plainLeftoverRemove", bytes)).toBe(
      LOADING_BUDGET_MS.plainLeftoverRemove + 8_000,
    );
  });

  it("gives a larger vault a longer budget than a smaller one", () => {
    const small = sizedBudgetMs("vaultClose", 50 * 1024 * 1024);
    const large = sizedBudgetMs("vaultClose", 20 * GIB);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(SIZED_WORK.vaultClose.floorMs);
  });

  it("never passes the ceiling", () => {
    for (const work of Object.keys(SIZED_WORK) as (keyof typeof SIZED_WORK)[]) {
      expect(sizedBudgetMs(work, 10_000 * GIB)).toBe(SIZED_BUDGET_CEILING_MS);
      expect(SIZED_WORK[work].floorMs).toBeLessThan(SIZED_BUDGET_CEILING_MS);
    }
  });
});
