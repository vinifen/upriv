/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRevealWhen } from "@/hooks/useRevealWhen";

function setup({ active, inputDisabled = false }: { active: boolean; inputDisabled?: boolean }) {
  const block = document.createElement("div");
  const input = document.createElement("input");
  input.disabled = inputDisabled;
  block.append(input);
  document.body.append(block);
  const scrollIntoView = vi.fn();
  block.scrollIntoView = scrollIntoView;
  const focus = vi.spyOn(input, "focus");

  const { result, rerender } = renderHook((on: boolean) => useRevealWhen<HTMLDivElement>(on), {
    initialProps: false,
  });
  result.current.current = block;
  rerender(active);

  return { input, scrollIntoView, focus };
}

describe("useRevealWhen", () => {
  let reducedMotion = false;

  beforeEach(() => {
    reducedMotion = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: reducedMotion })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("does nothing while inactive", () => {
    const { scrollIntoView, focus } = setup({ active: false });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("scrolls the whole block into view and focuses its input without a second scroll", () => {
    const { input, scrollIntoView, focus } = setup({ active: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(input);
  });

  it("jumps instead of animating when reduced motion is requested", () => {
    reducedMotion = true;
    const { scrollIntoView } = setup({ active: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });

  it("skips a disabled input", () => {
    const { focus } = setup({ active: true, inputDisabled: true });
    expect(focus).not.toHaveBeenCalled();
  });
});
