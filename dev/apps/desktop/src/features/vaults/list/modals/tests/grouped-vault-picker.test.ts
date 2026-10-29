/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultListItem } from "@upriv/shared";
import { GroupedVaultPicker } from "../GroupedVaultPicker";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));

function vaults(count: number): VaultListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    displayName: `Vault ${i}`,
    session: null,
    storageMode: "encrypted_dir",
    lastAccessedWhen: "",
    lastAccessedAt: "",
    note: "",
  }));
}

function show(count: number) {
  const props = { groups: [], selectedIds: [], onToggle: vi.fn() };
  const view = render(createElement(GroupedVaultPicker, { ...props, vaults: vaults(count) }));
  return {
    resize: (next: number) =>
      view.rerender(createElement(GroupedVaultPicker, { ...props, vaults: vaults(next) })),
  };
}

function search(): HTMLInputElement | null {
  return screen.queryByPlaceholderText("vault.group.picker.search");
}

afterEach(cleanup);

describe("GroupedVaultPicker", () => {
  it("shows six vaults whole, as checkboxes, with no search", () => {
    show(6);
    expect(search()).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("scrolls past six rows and offers search from the seventh vault", () => {
    show(7);
    expect(search()).not.toBeNull();
    const list = screen.getAllByRole("checkbox")[0].closest("div");
    expect(list?.style.maxHeight).toBe("226px");

    fireEvent.change(search()!, { target: { value: "Vault 3" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("drops a typed search once the list is short enough to show whole", () => {
    const { resize } = show(7);
    fireEvent.change(search()!, { target: { value: "Vault 3" } });
    resize(6);
    expect(search()).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);

    resize(7);
    expect(search()?.value).toBe("");
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  });
});
