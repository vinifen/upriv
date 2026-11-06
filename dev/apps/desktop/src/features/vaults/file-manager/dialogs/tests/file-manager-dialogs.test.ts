/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATION_LIMIT_MS, type HeldSummary } from "@upriv/shared";
import type { VaultHeld } from "@upriv/shared/react";
import { I18nProvider } from "@/i18n";
import type { FileManagerApi } from "../../hooks/useVaultFileManager";
import { FileManagerDialogs } from "../FileManagerDialogs";

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function heldWith(summary: HeldSummary | null, open = false): VaultHeld {
  return {
    summary,
    open,
    show: vi.fn(),
    working: new Set(),
    restore: vi.fn(async (names: string[]) => names.map((name) => `/${name}.txt`)),
    remove: vi.fn(async () => true),
  };
}

const NO_HELD = heldWith(null);

function renderDeletePrompt() {
  const fm = {
    workspace: {
      deleteTarget: { path: "/note.md", name: "note.md", isFolder: false },
      unsavedPrompt: null,
    },
    held: NO_HELD,
    dispatch: vi.fn(),
    confirmDelete: vi.fn(),
    stopAskingBeforeDelete: vi.fn(),
    toast: null,
    dismissToast: vi.fn(),
  } as unknown as FileManagerApi;
  render(
    createElement(I18nProvider, {
      locale: "en",
      children: createElement(FileManagerDialogs, { fm }),
    }),
  );
  return fm;
}

function renderUnsavedPrompt(unsavedSaving: boolean) {
  const fm = {
    workspace: {
      deleteTarget: null,
      unsavedPrompt: { type: "close_tab", path: "/note.md" },
    },
    held: NO_HELD,
    unsavedSaving,
    abandonUnsavedSave: vi.fn(),
    dispatch: vi.fn(),
    confirmUnsaved: vi.fn(),
    confirmSaveUnsaved: vi.fn(),
    toast: null,
    dismissToast: vi.fn(),
  } as unknown as FileManagerApi;
  render(
    createElement(I18nProvider, {
      locale: "en",
      children: createElement(FileManagerDialogs, { fm }),
    }),
  );
  return fm;
}

describe("FileManagerDialogs unsaved prompt", () => {
  it("offers its three answers before a save starts", async () => {
    const fm = renderUnsavedPrompt(false);
    fireEvent.click(await screen.findByRole("button", { name: "Save & close" }));
    expect(fm.confirmSaveUnsaved).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fm.dispatch).toHaveBeenCalledWith({ type: "set_unsaved_prompt", prompt: null });
  });

  it("turns every answer off while the save runs", async () => {
    const fm = renderUnsavedPrompt(true);
    const save = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & close" });
    const cancel = screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" });
    const discard = screen.getByRole<HTMLButtonElement>("button", { name: "Discard changes" });
    expect([save.disabled, cancel.disabled, discard.disabled]).toEqual([true, true, true]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(fm.dispatch).not.toHaveBeenCalled();
  });

  it("gives up on a save past the operation limit", async () => {
    vi.useFakeTimers();
    try {
      const fm = renderUnsavedPrompt(true);
      // The translations load first, and the dialogs and their clock start after that.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPERATION_LIMIT_MS + 1_000);
      });
      expect(fm.abandonUnsavedSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FileManagerDialogs delete prompt", () => {
  it("deletes and keeps asking when Don't ask again is left off", async () => {
    const fm = renderDeletePrompt();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(fm.confirmDelete).toHaveBeenCalledTimes(1);
    expect(fm.stopAskingBeforeDelete).not.toHaveBeenCalled();
  });

  it("saves Don't ask again in the vault settings when checked", async () => {
    const fm = renderDeletePrompt();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Don't ask again" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(fm.confirmDelete).toHaveBeenCalledTimes(1);
    expect(fm.stopAskingBeforeDelete).toHaveBeenCalledTimes(1);
  });
});

describe("FileManagerDialogs set-aside data", () => {
  function renderHeld() {
    const held = heldWith(
      {
        files: [
          {
            name: "report",
            size: 300,
            heldAt: 1,
            file: { path: "/docs/report.txt", size: 6, modifiedAt: 5, currentModifiedAt: 2 },
          },
        ],
        pieces: [{ name: "piece", size: 2048, heldAt: 1, file: null }],
        pieceBytes: 2048,
      },
      true,
    );
    const fm = {
      workspace: { deleteTarget: null, unsavedPrompt: null },
      held,
      dispatch: vi.fn(),
      showToast: vi.fn(),
      toast: null,
      dismissToast: vi.fn(),
    } as unknown as FileManagerApi;
    render(
      createElement(I18nProvider, {
        locale: "en",
        children: createElement(FileManagerDialogs, { fm }),
      }),
    );
    return { fm, held };
  }

  it("lists each file with how it compares, and the pieces by size", async () => {
    renderHeld();
    expect(await screen.findByText("report.txt")).toBeTruthy();
    expect(screen.getByText("/docs")).toBeTruthy();
    expect(screen.getByText(/Newer than the file in the vault/)).toBeTruthy();
    expect(screen.getByText(/1 piece\(s\), 2\.0 KB/)).toBeTruthy();
  });

  it("puts a file back and says where it is", async () => {
    const { fm, held } = renderHeld();
    fireEvent.click(await screen.findByRole("button", { name: "Put back" }));
    await act(async () => undefined);
    expect(held.restore).toHaveBeenCalledWith(["report"]);
    expect(fm.showToast).toHaveBeenCalledWith("Put back as /report.txt.");
  });

  it("deletes a file or the pieces only from the footer's question", async () => {
    const { held } = renderHeld();
    // A double click on the row's Delete only asks.
    const rowDelete = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(rowDelete);
    fireEvent.click(rowDelete);
    expect(held.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Delete “report.txt” for good?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete “report.txt” for good?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const [, footerDelete] = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(footerDelete);
    expect(held.remove).toHaveBeenCalledWith(["report"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete pieces" }));
    expect(screen.getByText("Delete 1 piece(s), 2.0 KB, for good?")).toBeTruthy();
    expect(held.remove).toHaveBeenCalledTimes(1);
    const [, piecesDelete] = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(piecesDelete);
    expect(held.remove).toHaveBeenLastCalledWith(["piece"]);
  });
});
