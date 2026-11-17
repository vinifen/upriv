/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultListItem, VaultPipelineListStatus } from "@upriv/shared";
import type { VaultDeleteJob } from "@upriv/shared/react";
import { VaultDeleteModal } from "../VaultDeleteModal";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/platform/services", () => ({ useVaultService: () => ({ canDeleteVault: true }) }));

const CLOSED: VaultListItem = {
  id: "notes",
  displayName: "Notes",
  session: null,
  storageMode: "encrypted_dir",
  lastAccessedWhen: "just now",
  lastAccessedAt: "2026-06-01T12:00:00.000Z",
  note: "",
};

function show(
  vault: VaultListItem | null,
  options: { pipeline?: VaultPipelineListStatus; job?: VaultDeleteJob | null } = {},
) {
  const onDelete = vi.fn(() => true);
  const onClose = vi.fn();
  const element = (current: VaultListItem | null) =>
    createElement(VaultDeleteModal, {
      vault: current,
      pipelineListStatus: options.pipeline ?? {},
      job: options.job ?? null,
      onClose,
      onDelete,
    });
  const { rerender } = render(element(vault));
  return { onDelete, onClose, show: (next: VaultListItem | null) => rerender(element(next)) };
}

function confirmField(): HTMLInputElement {
  return screen.getByLabelText("modal.delete_vault.confirm");
}

function deleteButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "modal.delete_vault.submit" });
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("Delete vault window", () => {
  it("is closed while no vault is chosen", () => {
    show(null);
    expect(screen.queryByText("modal.delete_vault.title")).toBeNull();
  });

  it("waits until the vault ID is typed, then deletes it", () => {
    const { onDelete } = show(CLOSED);
    expect(deleteButton().disabled).toBe(true);
    fireEvent.change(confirmField(), { target: { value: "Notes" } });
    expect(deleteButton().disabled).toBe(true);
    fireEvent.change(confirmField(), { target: { value: " notes " } });
    expect(deleteButton().disabled).toBe(false);
    fireEvent.click(deleteButton());
    expect(onDelete).toHaveBeenCalledWith("notes", false);
    expect(confirmField().value).toBe("");
  });

  it("runs from Enter in the field once the ID is typed", () => {
    const { onDelete } = show(CLOSED);
    fireEvent.keyDown(confirmField(), { key: "Enter" });
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.change(confirmField(), { target: { value: "notes" } });
    fireEvent.keyDown(confirmField(), { key: "Enter" });
    expect(onDelete).toHaveBeenCalledWith("notes", false);
  });

  it("sends the outside-backups switch, shown only when the vault keeps backups there", () => {
    show(CLOSED);
    expect(screen.queryByRole("switch")).toBeNull();
    cleanup();
    const { onDelete } = show({ ...CLOSED, outsideBackups: true });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(confirmField(), { target: { value: "notes" } });
    fireEvent.click(deleteButton());
    expect(onDelete).toHaveBeenCalledWith("notes", true);
  });

  it("says why it waits while the vault is open, and does not start", () => {
    const { onDelete } = show({ ...CLOSED, session: "open" });
    expect(screen.getByText("modal.delete_vault.hold.busy")).not.toBeNull();
    expect(confirmField().disabled).toBe(true);
    expect(deleteButton().disabled).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("offers Continue on a delete that did not finish, with nothing to type", () => {
    const { onDelete } = show({ ...CLOSED, session: "deleting", deleteUnfinished: true });
    expect(screen.getByText("modal.delete_vault.unfinished")).not.toBeNull();
    expect(screen.queryByLabelText("modal.delete_vault.confirm")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "action.continue_delete" }));
    expect(onDelete).toHaveBeenCalledWith("notes", false);
  });

  it("shows a running delete's progress in place of its fields and buttons", () => {
    const job: VaultDeleteJob = {
      vaultId: "notes",
      displayName: "Notes",
      id: "job-1",
      startedAt: Date.now(),
      progress: { bytesDone: 1, bytesTotal: 4, stoppable: true, step: "overwriting" },
      stoppingSince: null,
    };
    show({ ...CLOSED, session: "deleting" }, { pipeline: { deletingVaultIds: ["notes"] }, job });
    expect(screen.getByRole("progressbar")).not.toBeNull();
    expect(screen.getByText("modal.delete_vault.running")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "modal.delete_vault.submit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "action.continue_delete" })).toBeNull();
  });

  it("starts over each time it opens", () => {
    const view = show(CLOSED);
    fireEvent.change(confirmField(), { target: { value: "notes" } });
    view.show(null);
    view.show(CLOSED);
    expect(confirmField().value).toBe("");
    expect(deleteButton().disabled).toBe(true);
  });
});
