/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "../DropdownMenu";
import { Modal } from "../Modal";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // jsdom lays nothing out: without a box in the viewport, the menu reads its
  // trigger as scrolled away and closes.
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ top: 100, left: 100, right: 200, bottom: 130, width: 100, height: 30 }) as DOMRect;
});

afterEach(cleanup);

describe("a menu opened inside a modal", () => {
  it("keeps the focus its items take, so a click on one lands", async () => {
    const onSelect = vi.fn();
    render(
      createElement(Modal, {
        open: true,
        title: "Settings",
        onClose: () => {},
        children: createElement(DropdownMenu, {
          label: "Folder 2",
          aboveModal: true,
          trigger: createElement("button", { type: "button", className: "trigger" }, "Options"),
          items: [{ id: "edit", label: "Edit", onSelect }],
        }),
      }),
    );
    // A real click focuses the button it presses.
    const trigger = screen.getByText("Options");
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const item = screen.getByText("Edit").closest("button");
    if (!item) throw new Error("no item");

    // A press on an item moves the focus out of the modal, into the portaled menu.
    await act(async () => {
      item.focus();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(item);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
