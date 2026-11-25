/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultListItem } from "@upriv/shared";
import { IMPORTING_ROW_POLL_MS, useRefreshWhileImporting } from "@upriv/shared/react";

const row = (id: string, session: VaultListItem["session"]) =>
  ({ id, displayName: id, session, storageMode: "encrypted_dir" }) as VaultListItem;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useRefreshWhileImporting", () => {
  it("reads the list again while an import this window does not run fills a row", () => {
    const reload = vi.fn();
    const { rerender } = renderHook(({ vaults }) => useRefreshWhileImporting(vaults, [], reload), {
      initialProps: { vaults: [row("notes", "importing")] },
    });
    vi.advanceTimersByTime(IMPORTING_ROW_POLL_MS * 2);
    expect(reload).toHaveBeenCalledTimes(2);

    rerender({ vaults: [row("notes", null)] });
    vi.advanceTimersByTime(IMPORTING_ROW_POLL_MS * 2);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("leaves a create of this window to its own pipeline", () => {
    const reload = vi.fn();
    renderHook(() => useRefreshWhileImporting([row("notes", "importing")], ["notes"], reload));
    vi.advanceTimersByTime(IMPORTING_ROW_POLL_MS * 2);
    expect(reload).not.toHaveBeenCalled();
  });
});
