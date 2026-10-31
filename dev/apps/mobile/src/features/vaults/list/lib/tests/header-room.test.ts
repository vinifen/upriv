import { describe, expect, it } from "vitest";
import { vaultListTitleFits, type VaultListHeaderLayout } from "../headerRoom";

/** Title 70 + every control closed: 22 + 8 + 70 + (8 + 40) + (12 + 46 + 8 + 46 + 8 + 46) = 314. */
function layout(overrides: Partial<VaultListHeaderLayout> = {}): VaultListHeaderLayout {
  return {
    rowWidth: 400,
    titleTextWidth: 70,
    showCreate: true,
    showSearch: true,
    searchOpen: false,
    showSort: true,
    showView: true,
    ...overrides,
  };
}

describe("vaultListTitleFits", () => {
  it("keeps the title while it fits beside every control", () => {
    expect(vaultListTitleFits(layout())).toBe(true);
    expect(vaultListTitleFits(layout({ rowWidth: 314 }))).toBe(true);
  });

  it("hides the title on a row too narrow for it and the buttons", () => {
    expect(vaultListTitleFits(layout({ rowWidth: 313 }))).toBe(false);
  });

  it("hides the title while the open search needs its room", () => {
    expect(vaultListTitleFits(layout({ searchOpen: true }))).toBe(false);
  });

  it("keeps the title beside the open search when hidden buttons leave room", () => {
    expect(vaultListTitleFits(layout({ searchOpen: true, showSort: false, showView: false }))).toBe(
      true,
    );
  });

  it("shows the title until the row and the title are measured", () => {
    expect(vaultListTitleFits(layout({ rowWidth: 0 }))).toBe(true);
    expect(vaultListTitleFits(layout({ titleTextWidth: 0, rowWidth: 100 }))).toBe(true);
  });
});
