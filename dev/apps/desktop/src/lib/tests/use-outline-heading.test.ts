/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOutlineHeading } from "@upriv/shared/react";

describe("useOutlineHeading", () => {
  it("follows the scroll until a heading is picked", () => {
    const { result } = renderHook(() => useOutlineHeading("a.md"));
    act(() => result.current.follow(2));
    expect(result.current.index).toBe(2);
    act(() => result.current.pick(5));
    expect(result.current.index).toBe(5);
  });

  it("keeps a picked heading while the jump scrolls past others", () => {
    const { result } = renderHook(() => useOutlineHeading("a.md"));
    act(() => result.current.pick(4));
    act(() => result.current.follow(1));
    act(() => result.current.follow(3));
    expect(result.current.index).toBe(4);
  });

  it("follows the scroll again once the user scrolls by hand", () => {
    const { result } = renderHook(() => useOutlineHeading("a.md"));
    act(() => result.current.pick(4));
    act(() => result.current.release());
    act(() => result.current.follow(1));
    expect(result.current.index).toBe(1);
  });

  it("starts over at the first heading for another file", () => {
    const { result, rerender } = renderHook(({ path }) => useOutlineHeading(path), {
      initialProps: { path: "a.md" },
    });
    act(() => result.current.pick(4));
    rerender({ path: "b.md" });
    expect(result.current.index).toBe(0);
    act(() => result.current.follow(2));
    expect(result.current.index).toBe(2);
  });
});
