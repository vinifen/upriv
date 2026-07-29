import { afterEach, describe, expect, it } from "vitest";
import {
  mockVaultLifecycleService,
  seedDemoOpenVaultPasswords,
  validateMockLifecyclePassword,
} from "../vaultLifecycleService";

describe("validateMockLifecyclePassword", () => {
  it.each([
    ["pass", true],
    ["abcd", true],
    ["  abcd  ", true],
    ["abc", false],
    ["", false],
    ["wrong", false],
    ["  wrong  ", false],
  ])("%j → %s", (password, expected) => {
    expect(validateMockLifecyclePassword(password)).toBe(expected);
  });
});

describe("seedDemoOpenVaultPasswords", () => {
  afterEach(() => {
    mockVaultLifecycleService.clearPasswordInSession("seed-a");
    mockVaultLifecycleService.clearPasswordInSession("seed-b");
  });

  it("seeds trimmed hints for open vaults without a session password", () => {
    seedDemoOpenVaultPasswords(["seed-a", "seed-b"], (id) =>
      id === "seed-a" ? "  childhood street  " : undefined,
    );
    expect(mockVaultLifecycleService.hasPasswordInSession("seed-a")).toBe(true);
    expect(mockVaultLifecycleService.hasPasswordInSession("seed-b")).toBe(false);
  });

  it("does not overwrite an existing session password", () => {
    mockVaultLifecycleService.setPasswordInSession("seed-a", "already-set");
    seedDemoOpenVaultPasswords(["seed-a"], () => "hint-should-skip");
    expect(mockVaultLifecycleService.hasPasswordInSession("seed-a")).toBe(true);
  });
});
