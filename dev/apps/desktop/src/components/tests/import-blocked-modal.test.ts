/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ImportBlockedReport } from "@upriv/shared";
import { ImportBlockedModal } from "../ImportBlockedModal";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
    locale: "en",
  }),
}));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function show(report: ImportBlockedReport | null) {
  const onLeaveOut = vi.fn();
  const onClose = vi.fn();
  render(createElement(ImportBlockedModal, { report, onLeaveOut, onClose }));
  return { onLeaveOut, onClose };
}

const DB: ImportBlockedReport = {
  vaultName: "Work",
  blocked: { count: 1, items: [{ path: "Work/db", reason: "permission" }], whole: false },
  stage: "refused",
};

describe("ImportBlockedModal", () => {
  it("names every item with why, and how many there are", () => {
    show({
      ...DB,
      blocked: {
        count: 2,
        items: [
          { path: "Work/db", reason: "permission" },
          { path: "Work/agent.sock", reason: "special" },
        ],
        whole: false,
      },
    });
    const list = screen.getByRole("list", { name: "modal.import_blocked.title" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Work/dbmodal.import_blocked.reason.permission",
      "Work/agent.sockmodal.import_blocked.reason.special",
    ]);
    expect(screen.getByText("modal.import_blocked.count 2")).toBeDefined();
    expect(screen.queryByText(/modal\.import_blocked\.more/)).toBeNull();
  });

  it("counts the items it does not name", () => {
    show({ ...DB, blocked: { ...DB.blocked, count: 501 } });
    expect(screen.getByText("modal.import_blocked.more 500")).toBeDefined();
  });

  it("imports without them, or cancels", () => {
    const { onLeaveOut, onClose } = show(DB);
    expect(screen.getByText("modal.import_blocked.body")).toBeDefined();
    fireEvent.click(screen.getByText("modal.import_blocked.leave_out"));
    expect(onLeaveOut).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("action.cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers only Close when the chosen item itself is what blocks", () => {
    const { onClose } = show({
      vaultName: "Notes",
      blocked: { count: 1, items: [{ path: "notes.txt", reason: "missing" }], whole: true },
      stage: "refused",
    });
    expect(screen.getByText("modal.import_blocked.body_whole")).toBeDefined();
    expect(screen.getByText("modal.import_blocked.count_one")).toBeDefined();
    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(screen.queryByText("modal.import_blocked.leave_out")).toBeNull();
    // The footer's Close, beside the window's own close icon.
    fireEvent.click(screen.getByText("action.close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports what a finished import left out, with only Close", () => {
    const { onClose } = show({
      vaultName: "Work",
      blocked: { count: 3, items: [{ path: "Photos/a.jpg", reason: "missing" }], whole: false },
      stage: "left_out",
    });
    expect(screen.getByText("modal.import_blocked.title_left_out")).toBeDefined();
    expect(screen.getByText("modal.import_blocked.body_left_out")).toBeDefined();
    expect(screen.getByText("modal.import_blocked.count_left_out 3")).toBeDefined();
    expect(screen.getByText("modal.import_blocked.more 2")).toBeDefined();
    expect(screen.queryByText("modal.import_blocked.leave_out")).toBeNull();
    fireEvent.click(screen.getByText("action.close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows nothing while no import has items to name", () => {
    show(null);
    expect(screen.queryByText("modal.import_blocked.title")).toBeNull();
  });
});
