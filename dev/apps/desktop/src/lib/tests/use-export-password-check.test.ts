/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useExportPasswordCheck } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useExportPasswordCheck", () => {
  it("keeps export blocked until this exact password unlocks the vault", async () => {
    const probe = vi.fn(async () => true);
    const { result, rerender } = renderHook(
      ({ password }: { password: string }) =>
        useExportPasswordCheck({
          open: true,
          vaultId: "notes",
          password,
          probe,
        }),
      { initialProps: { password: "pass-word-ok" } },
    );
    expect(result.current.passwordOk).toBe(false);
    expect(result.current.canCheck).toBe(true);

    await act(async () => {
      result.current.check();
    });
    expect(probe).toHaveBeenCalledWith("notes", "pass-word-ok");
    expect(result.current.passwordOk).toBe(true);
    expect(result.current.canCheck).toBe(false);

    rerender({ password: "pass-word-ok " });
    expect(result.current.passwordOk).toBe(false);
    expect(result.current.canCheck).toBe(true);
  });

  it("does not apply a late wrong-password result after the field changes", async () => {
    const first = deferred<boolean>();
    const probe = vi.fn(() => first.promise);
    const { result, rerender } = renderHook(
      ({ password }: { password: string }) =>
        useExportPasswordCheck({
          open: true,
          vaultId: "notes",
          password,
          probe,
        }),
      { initialProps: { password: "old-pass" } },
    );

    act(() => {
      result.current.check();
    });
    rerender({ password: "new-pass" });
    act(() => {
      result.current.notePasswordEdited();
    });

    await act(async () => {
      first.resolve(false);
    });
    expect(result.current.passwordWrong).toBe(false);
    expect(result.current.checking).toBe(false);
    expect(result.current.passwordOk).toBe(false);
  });
});
