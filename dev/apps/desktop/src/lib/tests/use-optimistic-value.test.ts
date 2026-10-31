/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOptimisticValue } from "@upriv/shared/react";

function deferred() {
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useOptimisticValue", () => {
  it("shows the new value while it saves, then the saved one", async () => {
    const save = deferred();
    const { result, rerender } = renderHook(
      ({ saved }: { saved: boolean }) => useOptimisticValue(saved, () => save.promise),
      { initialProps: { saved: false } },
    );

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    rerender({ saved: true });
    await act(async () => save.resolve(true));
    expect(result.current[0]).toBe(true);
  });

  it("goes back to the saved value when the save fails", async () => {
    const save = deferred();
    const { result } = renderHook(() => useOptimisticValue(false, () => save.promise));

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    await act(async () => save.resolve(false));
    expect(result.current[0]).toBe(false);
  });

  it("keeps the latest choice while an earlier save ends", async () => {
    const saves = [deferred(), deferred()];
    let call = 0;
    const { result } = renderHook(() =>
      useOptimisticValue(false, () => saves[call++]?.promise ?? Promise.resolve(true)),
    );

    act(() => result.current[1](true));
    act(() => result.current[1](false));
    await act(async () => saves[0].resolve(true));
    expect(result.current[0]).toBe(false);
  });
});
