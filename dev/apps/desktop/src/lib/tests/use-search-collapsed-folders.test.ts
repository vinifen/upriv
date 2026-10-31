/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSearchCollapsedFolders } from "@upriv/shared/react";

function setup() {
  return renderHook(({ vaultId, query }) => useSearchCollapsedFolders(vaultId, query), {
    initialProps: { vaultId: "notes", query: "plan" },
  });
}

describe("useSearchCollapsedFolders", () => {
  afterEach(cleanup);

  it("collapses a folder and opens it again", () => {
    const { result } = setup();
    expect(result.current.collapsed.has("/docs")).toBe(false);

    act(() => result.current.toggle("/docs"));
    expect(result.current.collapsed.has("/docs")).toBe(true);

    act(() => result.current.toggle("/docs"));
    expect(result.current.collapsed.has("/docs")).toBe(false);
  });

  it("starts over for a new query and stays over when the old one comes back", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggle("/docs"));

    rerender({ vaultId: "notes", query: "plans" });
    expect(result.current.collapsed.size).toBe(0);
    act(() => result.current.toggle("/photos"));

    rerender({ vaultId: "notes", query: "plan" });
    expect(result.current.collapsed.size).toBe(0);
  });

  it("does not carry a folder into another vault with the same query", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggle("/docs"));

    rerender({ vaultId: "photos", query: "plan" });
    expect(result.current.collapsed.size).toBe(0);
  });
});
