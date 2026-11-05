/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TREE_SPLIT_MAX_PERCENT, TREE_SPLIT_MIN_PERCENT } from "@upriv/shared";
import { I18nProvider } from "@/i18n";
import { PaneResizeHandle } from "../PaneResizeHandle";

afterEach(cleanup);

const treeRange = { min: TREE_SPLIT_MIN_PERCENT, max: TREE_SPLIT_MAX_PERCENT };

describe("PaneResizeHandle", () => {
  it("exposes the range and value to assistive tech", async () => {
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(PaneResizeHandle, {
          axis: "x",
          value: 20,
          ...treeRange,
          onDrag: vi.fn(),
          onNudge: vi.fn(),
        }),
      }),
    );

    const handle = await screen.findByRole("separator");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(TREE_SPLIT_MIN_PERCENT));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(TREE_SPLIT_MAX_PERCENT));
    expect(handle.getAttribute("aria-valuenow")).toBe("20");
  });

  it("jumps to the range ends on Home and End and steps on arrows", async () => {
    const onNudge = vi.fn();
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(PaneResizeHandle, {
          axis: "x",
          value: 20,
          ...treeRange,
          onDrag: vi.fn(),
          onNudge,
        }),
      }),
    );

    const handle = await screen.findByRole("separator");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onNudge).toHaveBeenLastCalledWith(TREE_SPLIT_MIN_PERCENT);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onNudge).toHaveBeenLastCalledWith(TREE_SPLIT_MAX_PERCENT);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onNudge).toHaveBeenLastCalledWith(21);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(onNudge).toHaveBeenLastCalledWith(15);
  });

  it("grows a pane after the divider when it moves left", async () => {
    const onNudge = vi.fn();
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(PaneResizeHandle, {
          axis: "x",
          value: 200,
          min: 112,
          max: 640,
          step: 8,
          sizes: "after",
          onDrag: vi.fn(),
          onNudge,
        }),
      }),
    );

    const handle = await screen.findByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onNudge).toHaveBeenLastCalledWith(208);
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(onNudge).toHaveBeenLastCalledWith(160);
  });

  it("takes no room of its own when it straddles a border", async () => {
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(PaneResizeHandle, {
          axis: "x",
          value: 200,
          min: 112,
          max: 640,
          overlay: true,
          onDrag: vi.fn(),
          onNudge: vi.fn(),
        }),
      }),
    );

    const handle = await screen.findByRole("separator");
    expect(handle.className).toContain("w-2");
    expect(handle.className).toContain("-mx-1");
  });

  it("forwards the pointer delta from the grab point", async () => {
    const onDragStart = vi.fn();
    const onDrag = vi.fn();
    const onDragEnd = vi.fn();

    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(PaneResizeHandle, {
          axis: "x",
          value: 20,
          ...treeRange,
          onDragStart,
          onDrag,
          onDragEnd,
          onNudge: vi.fn(),
        }),
      }),
    );

    const handle = await screen.findByRole("separator");
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    const firePointer = (type: string, clientX: number, buttons = 1) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        clientX,
        clientY: 100,
        pointerId: 1,
        button: 0,
        buttons,
        pointerType: "mouse",
      });
      handle.dispatchEvent(event);
    };

    firePointer("pointerdown", 200);
    expect(onDragStart).toHaveBeenCalledTimes(1);

    firePointer("pointermove", 120);
    expect(onDrag).toHaveBeenCalledWith(-80);

    firePointer("pointerup", 120, 0);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
