/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultListItem } from "@upriv/shared";
import { VaultRecoveryModal } from "../VaultRecoveryModal";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function show(row: Partial<VaultListItem>) {
  const onAction = vi.fn();
  const onDelete = vi.fn();
  const onFinishPasswordChange = vi.fn();
  render(
    createElement(VaultRecoveryModal, {
      vault: {
        id: "notes",
        displayName: "Notes",
        session: "recovery",
        storageMode: "encrypted_dir",
        ...row,
      } as VaultListItem,
      leftover: null,
      open: true,
      onClose: () => {},
      onAction,
      onFinishPasswordChange,
      onDelete,
    }),
  );
  return { onAction, onDelete, onFinishPasswordChange };
}

describe("VaultRecoveryModal", () => {
  it("keeps what a cut-off import got in with the unlock, or deletes the vault", () => {
    const { onAction, onDelete } = show({ importUnfinished: true });
    expect(screen.getByText("recovery.import_unfinished")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "recovery.keep_import" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "resume_store" });
    fireEvent.click(screen.getByRole("button", { name: "modal.delete_vault.title" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("offers no keep and no delete for a close that did not finish", () => {
    const { onAction } = show({});
    expect(screen.getByText("recovery.hint")).toBeDefined();
    expect(screen.queryByRole("button", { name: "recovery.keep_import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "modal.delete_vault.title" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "action.continue" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "resume_store" });
  });

  it("finishes a password change before it keeps an import", () => {
    const { onFinishPasswordChange } = show({
      importUnfinished: true,
      passwordChange: "unfinished",
    });
    expect(screen.queryByText("recovery.import_unfinished")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "recovery.finish_password_change" }));
    expect(onFinishPasswordChange).toHaveBeenCalledOnce();
  });
});
