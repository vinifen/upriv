/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VaultListItem } from "@upriv/shared";
import { useAttachWhenFoldersTurnOn } from "../useAttachWhenFoldersTurnOn";

function vault(
  id: string,
  session: VaultListItem["session"],
  storageMode: VaultListItem["storageMode"] = "encrypted_dir",
): VaultListItem {
  return { id, session, storageMode } as VaultListItem;
}

const VAULTS = {
  current: [
    vault("notes", "open"),
    vault("photos", null),
    vault("plain", "open", "upriv_plain"),
    vault("leaving", "closing"),
  ],
};

function mount(on: boolean) {
  const attach = vi.fn();
  const hook = renderHook(({ on }) => useAttachWhenFoldersTurnOn(on, VAULTS, attach), {
    initialProps: { on },
  });
  return { attach, rerender: (next: boolean) => hook.rerender({ on: next }) };
}

describe("useAttachWhenFoldersTurnOn", () => {
  it("attaches every open encrypted vault once the switch turns on", () => {
    const { attach, rerender } = mount(false);
    expect(attach).not.toHaveBeenCalled();
    rerender(true);
    expect(attach.mock.calls).toEqual([["notes"]]);
  });

  it("does nothing while the switch stays on, or when it turns off", () => {
    const { attach, rerender } = mount(true);
    rerender(true);
    rerender(false);
    expect(attach).not.toHaveBeenCalled();
  });
});
