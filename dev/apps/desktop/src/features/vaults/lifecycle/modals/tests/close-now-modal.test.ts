/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultListItem } from "@upriv/shared";
import { CloseNowModal } from "../CloseNowModal";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));

function vault(id: string, storageMode: VaultListItem["storageMode"]): VaultListItem {
  return { id, displayName: id, storageMode } as VaultListItem;
}

function modal(props: Partial<Parameters<typeof CloseNowModal>[0]>) {
  return createElement(CloseNowModal, {
    vault: vault("notes", "encrypted_dir"),
    unsaved: false,
    asks: true,
    onCancel: () => {},
    onConfirm: () => {},
    ...props,
  });
}

function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "modal.close_now.confirm" }));
}

describe("CloseNowModal", () => {
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it("stays closed with no vault", () => {
    render(modal({ vault: null }));
    expect(screen.queryByText("modal.close_now.title")).toBeNull();
  });

  it("says the folder is not wiped only on a plain-text vault", () => {
    const { rerender } = render(modal({}));
    expect(screen.getByText("modal.close_now.no_backup")).toBeTruthy();
    expect(screen.getByText("modal.close_now.changes_lost")).toBeTruthy();
    expect(screen.queryByText("modal.close_now.not_wiped")).toBeNull();
    rerender(modal({ vault: vault("notes", "upriv_plain") }));
    expect(screen.getByText("modal.close_now.no_backup")).toBeTruthy();
    expect(screen.getByText("modal.close_now.changes_lost_plain")).toBeTruthy();
    expect(screen.getByText("modal.close_now.not_wiped")).toBeTruthy();
  });

  it("names unsaved editor tabs only when there are some", () => {
    const { rerender } = render(modal({}));
    expect(screen.queryByText("modal.close_now.unsaved")).toBeNull();
    rerender(modal({ unsaved: true }));
    expect(screen.getByText("modal.close_now.unsaved")).toBeTruthy();
  });

  it("offers Don't ask again only while the setting is on", () => {
    const { rerender } = render(modal({ unsaved: true, asks: false }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    rerender(modal({ unsaved: true, asks: true }));
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("confirms with the checkbox as it stands", () => {
    const onConfirm = vi.fn();
    render(modal({ onConfirm }));
    confirm();
    expect(onConfirm).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("modal.close_now.dont_ask_hint")).toBeTruthy();
    confirm();
    expect(onConfirm).toHaveBeenLastCalledWith(true);
  });

  it("clears the checkbox for the next vault", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(modal({ onConfirm }));
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(modal({ onConfirm, vault: vault("photos", "encrypted_dir") }));
    confirm();
    expect(onConfirm).toHaveBeenLastCalledWith(false);
  });
});
