/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { FileEditorSearch, type FileEditorSearchProps } from "../FileEditorSearch";

afterEach(cleanup);

function renderWithI18n(node: ReactNode) {
  return render(createElement(I18nProvider, { locale: "en", children: node }));
}

function defaultProps(overrides: Partial<FileEditorSearchProps> = {}): FileEditorSearchProps {
  return {
    query: "",
    totalMatches: 0,
    activeMatchIndex: 0,
    onQueryChange: vi.fn(),
    onNextMatch: vi.fn(),
    onPrevMatch: vi.fn(),
    ...overrides,
  };
}

describe("FileEditorSearch", () => {
  it("renders a collapsed circular button when empty, and stays open with input when query is present", async () => {
    const onNextMatch = vi.fn();
    const onPrevMatch = vi.fn();

    const { rerender } = renderWithI18n(
      createElement(FileEditorSearch, defaultProps({ query: "", onNextMatch, onPrevMatch })),
    );
    const btn = await screen.findByRole("button", { name: "Find in file (Ctrl+F)" });
    expect(btn).toBeTruthy();
    expect(screen.queryByPlaceholderText("Find in file…")).toBeNull();

    rerender(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(
          FileEditorSearch,
          defaultProps({
            query: "active_query",
            totalMatches: 3,
            activeMatchIndex: 0,
            onNextMatch,
            onPrevMatch,
          }),
        ),
      }),
    );

    // When query has text, search is always open with input, match count, and arrows
    const input = (await screen.findByPlaceholderText("Find in file…")) as HTMLInputElement;
    expect(input.value).toBe("active_query");
    expect(screen.getByText("1/3")).toBeTruthy();

    const prevBtn = screen.getByRole("button", { name: "Previous match (Shift+Enter)" });
    const nextBtn = screen.getByRole("button", { name: "Next match (Enter)" });
    expect(prevBtn).toBeTruthy();
    expect(nextBtn).toBeTruthy();

    fireEvent.click(nextBtn);
    expect(onNextMatch).toHaveBeenCalledTimes(1);

    fireEvent.click(prevBtn);
    expect(onPrevMatch).toHaveBeenCalledTimes(1);
  });

  it("opens on click when empty, handles typing, match navigation, and collapses on Escape", async () => {
    const onQueryChange = vi.fn();
    const onNextMatch = vi.fn();
    const onPrevMatch = vi.fn();

    const { rerender } = renderWithI18n(
      createElement(
        FileEditorSearch,
        defaultProps({
          query: "",
          totalMatches: 0,
          onQueryChange,
          onNextMatch,
          onPrevMatch,
        }),
      ),
    );

    const btn = await screen.findByRole("button", { name: "Find in file (Ctrl+F)" });
    fireEvent.click(btn);

    const input = (await screen.findByPlaceholderText("Find in file…")) as HTMLInputElement;
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "testing" } });
    expect(onQueryChange).toHaveBeenCalledWith("testing");

    // Simulating parent updating query to "testing"
    rerender(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(
          FileEditorSearch,
          defaultProps({
            query: "testing",
            totalMatches: 2,
            activeMatchIndex: 0,
            onQueryChange,
            onNextMatch,
            onPrevMatch,
          }),
        ),
      }),
    );

    expect(screen.getByText("1/2")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNextMatch).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onPrevMatch).toHaveBeenCalledTimes(1);

    // Arrow keys while focused in input step matches and prevent caret movement
    const arrowDownEvt = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
      bubbles: true,
    });
    input.dispatchEvent(arrowDownEvt);
    expect(arrowDownEvt.defaultPrevented).toBe(true);
    expect(onNextMatch).toHaveBeenCalledTimes(2);

    const arrowUpEvt = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
      bubbles: true,
    });
    input.dispatchEvent(arrowUpEvt);
    expect(arrowUpEvt.defaultPrevented).toBe(true);
    expect(onPrevMatch).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(input, { key: "Escape" });
    // Escape clears the query
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("stays open when clicking outside if query is present", async () => {
    renderWithI18n(
      createElement(
        FileEditorSearch,
        defaultProps({
          query: "persistent_query",
          totalMatches: 1,
        }),
      ),
    );

    expect(await screen.findByPlaceholderText("Find in file…")).toBeTruthy();

    // Clicking outside on document body
    fireEvent.pointerDown(document.body);

    // Still open because there is text in query
    expect(screen.getByPlaceholderText("Find in file…")).toBeTruthy();
  });

  it("does not collapse when user focuses input and deletes all text from existing query", async () => {
    const onQueryChange = vi.fn();
    const { rerender } = renderWithI18n(
      createElement(FileEditorSearch, defaultProps({ query: "initial", onQueryChange })),
    );
    const input = (await screen.findByPlaceholderText("Find in file…")) as HTMLInputElement;
    expect(input).toBeTruthy();

    // User focuses input and deletes text
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(onQueryChange).toHaveBeenCalledWith("");

    // Rerender with empty query as updated by parent
    rerender(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileEditorSearch, defaultProps({ query: "", onQueryChange })),
      }),
    );

    // Must remain open because input is still focused
    expect(screen.getByPlaceholderText("Find in file…")).toBeTruthy();

    // Only collapses when clicking outside
    fireEvent.pointerDown(document.body);
    expect(screen.queryByPlaceholderText("Find in file…")).toBeNull();
    expect(screen.getByRole("button", { name: "Find in file (Ctrl+F)" })).toBeTruthy();
  });

  it("disables next and prev buttons when totalMatches is 0 and does not render a close button", async () => {
    renderWithI18n(
      createElement(
        FileEditorSearch,
        defaultProps({
          query: "nomatch",
          totalMatches: 0,
        }),
      ),
    );

    expect(await screen.findByText("∅")).toBeTruthy();
    const prevBtn = screen.getByRole("button", { name: "Previous match (Shift+Enter)" });
    const nextBtn = screen.getByRole("button", { name: "Next match (Enter)" });
    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);

    // No close ('✕') button exists
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("clamps the active match index display when totalMatches is smaller than activeMatchIndex", async () => {
    renderWithI18n(
      createElement(
        FileEditorSearch,
        defaultProps({
          query: "abc",
          totalMatches: 2,
          activeMatchIndex: 5,
        }),
      ),
    );

    expect(await screen.findByText("2/2")).toBeTruthy();
  });
});
