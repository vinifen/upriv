/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderPresence } from "@upriv/shared";
import { useFolderFallback } from "@upriv/shared/react";

type Presence = ReadonlyMap<string, FolderPresence> | null;

const notInFolder: Presence = new Map([["/big.png", "none"]]);

function setup(initial: { tooLarge: boolean; presence: Presence }) {
  const send = vi.fn();
  const hook = renderHook(
    ({ tooLarge, presence }) => useFolderFallback("/big.png", tooLarge, presence, send),
    { initialProps: initial },
  );
  return { send, ...hook };
}

describe("useFolderFallback", () => {
  afterEach(cleanup);

  it("sends a file the person opened once it turns out too large", () => {
    const { send, result, rerender } = setup({ tooLarge: false, presence: notInFolder });
    act(() => result.current("/big.png"));
    expect(send).not.toHaveBeenCalled();

    rerender({ tooLarge: true, presence: notInFolder });
    expect(send).toHaveBeenCalledWith("/big.png");
  });

  it("sends it once", () => {
    const { send, result, rerender } = setup({ tooLarge: false, presence: notInFolder });
    act(() => result.current("/big.png"));
    rerender({ tooLarge: true, presence: notInFolder });
    rerender({ tooLarge: true, presence: new Map(notInFolder) });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves a tab restored with the vault alone", () => {
    const { send } = setup({ tooLarge: true, presence: notInFolder });
    expect(send).not.toHaveBeenCalled();
  });

  it("writes nothing for a file the viewer can show", () => {
    const { send, result, rerender } = setup({ tooLarge: false, presence: notInFolder });
    act(() => result.current("/big.png"));
    rerender({ tooLarge: false, presence: notInFolder });
    expect(send).not.toHaveBeenCalled();
  });

  it("writes nothing for a vault without a folder of chosen files", () => {
    const { send, result, rerender } = setup({ tooLarge: false, presence: null });
    act(() => result.current("/big.png"));
    rerender({ tooLarge: true, presence: null });
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves a file already in the folder", () => {
    const inFolder: Presence = new Map([["/big.png", "all"]]);
    const { send, result, rerender } = setup({ tooLarge: false, presence: inFolder });
    act(() => result.current("/big.png"));
    rerender({ tooLarge: true, presence: inFolder });
    expect(send).not.toHaveBeenCalled();
  });
});
