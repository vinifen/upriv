/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyCreateVaultDraft,
  ROW_ROLE_GUARD_MS,
  type CreateVaultDraft,
} from "@upriv/shared";
import { useCreateVaultWizard } from "@upriv/shared/react";

afterEach(() => {
  vi.restoreAllMocks();
});

function scratchDraft(password: string, overrides: Partial<CreateVaultDraft> = {}) {
  return {
    ...createEmptyCreateVaultDraft([]),
    source: "scratch" as const,
    displayName: "Lighthouse Ledger",
    password,
    passwordConfirm: password,
    ...overrides,
  };
}

function wizard(initialDraft: CreateVaultDraft) {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  const rendered = renderHook(() =>
    useCreateVaultWizard({
      open: true,
      existingVaultIds: [],
      existingOrders: [],
      initialDraft,
      initialStep: "advanced",
      onCreate,
      onClose,
      testImportPassword: vi.fn(),
      stopJob: vi.fn(async () => undefined),
    }),
  );
  return { ...rendered, onCreate, onClose };
}

describe("useCreateVaultWizard / password weakness", () => {
  it("checks the new password against the vault's own name", () => {
    const { result } = wizard(scratchDraft("Lighthouse Ledger 7"));
    expect(result.current.passwordWeakness).toBe("public");
  });

  it("goes away once the password is fixed", () => {
    const { result } = wizard(scratchDraft("abc"));
    expect(result.current.passwordWeakness).toBe("too_short");
    const password = "the quiet river behind us";
    act(() => result.current.patchDraft({ password, passwordConfirm: password }));
    expect(result.current.passwordWeakness).toBeNull();
  });

  it("shows the notice in the footer on the first press and creates on the next", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { result, onCreate, onClose } = wizard(scratchDraft("password1"));
    expect(result.current.passwordWeakness).toBe("common");
    expect(result.current.footerPasswordWeakness).toBeNull();

    act(() => result.current.handleCreate());
    expect(result.current.footerPasswordWeakness).toBe("common");
    expect(onCreate).not.toHaveBeenCalled();

    now.mockReturnValue(10_000 + ROW_ROLE_GUARD_MS);
    act(() => result.current.handleCreate());
    expect(onCreate).toHaveBeenCalledWith(expect.anything(), "password1");
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores the second half of a double click on Create", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { result, onCreate } = wizard(scratchDraft("password1"));
    act(() => result.current.handleCreate());
    now.mockReturnValue(10_000 + ROW_ROLE_GUARD_MS - 1);
    act(() => result.current.handleCreate());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("creates at once when nothing is wrong with the password", () => {
    const { result, onCreate } = wizard(scratchDraft("the quiet river behind us"));
    act(() => result.current.handleCreate());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("takes the footer notice down on an edit, and shows it again on the next press", () => {
    const { result, onCreate } = wizard(scratchDraft("password1"));
    act(() => result.current.handleCreate());
    act(() => result.current.patchDraft({ password: "password2", passwordConfirm: "password2" }));
    expect(result.current.footerPasswordWeakness).toBeNull();
    act(() => result.current.handleCreate());
    expect(result.current.footerPasswordWeakness).toBe("common");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does not judge a password the import keeps", () => {
    const backup = scratchDraft("", {
      source: "import",
      importKind: "backup",
      importFileName: "2026-01-01-ledger.zip",
      importFilePath: "/backups/2026-01-01-ledger.zip",
    });
    const { result } = wizard(backup);
    expect(result.current.passwordWeakness).toBeNull();
  });
});
