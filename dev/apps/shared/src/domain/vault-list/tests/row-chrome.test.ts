import { describe, expect, it } from "vitest";
import {
  VAULT_BLOCKS_THREE_COL_MIN_PX,
  VAULT_BLOCKS_TWO_COL_MIN_PX,
  VAULT_ROW_COMFORTABLE_MIN_PX,
  vaultBlocksColumnCount,
  vaultBlocksGroupColumnSpan,
  vaultBlocksGroupInnerColumns,
  vaultRowChrome,
} from "../rowChrome";

describe("vaultRowChrome", () => {
  it("is compact below the shared cutoff (phone portrait, nested group, narrow desktop)", () => {
    expect(vaultRowChrome(0)).toBe("compact");
    expect(vaultRowChrome(358)).toBe("compact");
    expect(vaultRowChrome(VAULT_ROW_COMFORTABLE_MIN_PX - 1)).toBe("compact");
  });

  it("is comfortable from the cutoff up (landscape, tablet, desktop list)", () => {
    expect(vaultRowChrome(VAULT_ROW_COMFORTABLE_MIN_PX)).toBe("comfortable");
    expect(vaultRowChrome(800)).toBe("comfortable");
    expect(vaultRowChrome(900)).toBe("comfortable");
  });
});

describe("vaultBlocksColumnCount", () => {
  it("is one column on phone-width lists", () => {
    expect(vaultBlocksColumnCount(0)).toBe(1);
    expect(vaultBlocksColumnCount(390)).toBe(1);
    expect(vaultBlocksColumnCount(VAULT_BLOCKS_TWO_COL_MIN_PX - 1)).toBe(1);
  });

  it("is two columns from sm up, three from lg", () => {
    expect(vaultBlocksColumnCount(VAULT_BLOCKS_TWO_COL_MIN_PX)).toBe(2);
    expect(vaultBlocksColumnCount(900)).toBe(2);
    expect(vaultBlocksColumnCount(VAULT_BLOCKS_THREE_COL_MIN_PX)).toBe(3);
  });
});

describe("vaultBlocksGroupColumnSpan", () => {
  it("keeps a one-vault or collapsed group in a single cell on a wide grid", () => {
    expect(vaultBlocksGroupColumnSpan(0, 2)).toBe(1);
    expect(vaultBlocksGroupColumnSpan(1, 2)).toBe(1);
    expect(vaultBlocksGroupColumnSpan(1, 3)).toBe(1);
  });

  it("spans two columns for two members, and the full row for three or more", () => {
    expect(vaultBlocksGroupColumnSpan(2, 2)).toBe(2);
    expect(vaultBlocksGroupColumnSpan(2, 3)).toBe(2);
    expect(vaultBlocksGroupColumnSpan(3, 2)).toBe(2);
    expect(vaultBlocksGroupColumnSpan(4, 3)).toBe(3);
  });
});

describe("vaultBlocksGroupInnerColumns", () => {
  it("stacks a single member and matches the outer span otherwise", () => {
    expect(vaultBlocksGroupInnerColumns(1, 3)).toBe(1);
    expect(vaultBlocksGroupInnerColumns(2, 3)).toBe(2);
    expect(vaultBlocksGroupInnerColumns(5, 3)).toBe(3);
    expect(vaultBlocksGroupInnerColumns(2, 1)).toBe(1);
  });
});
