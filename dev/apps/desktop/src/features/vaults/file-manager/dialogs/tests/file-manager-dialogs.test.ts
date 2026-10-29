/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
