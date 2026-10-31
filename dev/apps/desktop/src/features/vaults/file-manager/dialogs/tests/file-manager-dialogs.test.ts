/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_BUDGET_MS } from "@upriv/shared";
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

function renderDeletePrompt() {
  const fm = {
    workspace: {
      deleteTarget: { path: "/note.md", name: "note.md", isFolder: false },
      unsavedPrompt: null,
    },
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

  it("gives up on a save past its budget", async () => {
    vi.useFakeTimers();
    try {
      const fm = renderUnsavedPrompt(true);
      // The translations load first, and the dialogs and their clock start after that.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOADING_BUDGET_MS.vaultPipeline + 1_000);
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
