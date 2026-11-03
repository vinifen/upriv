/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDefaultAppSettings } from "@upriv/shared";
import { publishQuitClose } from "@/lib/quitClose";
import { publishRunningWork } from "@/lib/runningWork";

const events = vi.hoisted(() => ({ quit: null as null | ((payload: unknown) => void) }));

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/features/system/settings", () => ({
  useAppSettingsContext: () => ({ settings: createDefaultAppSettings(), patchSettings: vi.fn() }),
}));
vi.mock("@/features/vaults/lifecycle", () => ({ CloseNowModal: () => null }));
vi.mock("@/lib/useDesktopEvent", () => ({
  useDesktopEvent: (name: string, handler: (payload: unknown) => void) => {
    if (name === "quit_closing") events.quit = handler;
  },
}));

import { QuitClosingOverlay } from "../QuitClosingOverlay";

function startQuit() {
  act(() => events.quit?.({ now: false }));
}

describe("QuitClosingOverlay", () => {
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    act(() => {
      publishQuitClose([]);
      publishRunningWork({ items: [], closing: 0 });
    });
  });

  it("only says it is quitting, with no Close now, when no vault was open", () => {
    render(createElement(QuitClosingOverlay));
    startQuit();
    expect(screen.getByText("quit.quitting.title")).toBeTruthy();
    expect(screen.getByText("quit.quitting.body")).toBeTruthy();
    expect(screen.queryByText("quit.closing.title")).toBeNull();
    expect(screen.queryByRole("button", { name: "quit.close_now" })).toBeNull();
  });

  it("lists each vault the quit closes, with Close now", () => {
    render(createElement(QuitClosingOverlay));
    act(() =>
      publishQuitClose([
        { vaultId: "notes", name: "Notes", stage: "flush", startedAt: Date.now() },
      ]),
    );
    startQuit();
    expect(screen.getByText("quit.closing.title")).toBeTruthy();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByText("vault.status.closing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "quit.close_now" })).toBeTruthy();
  });
});
