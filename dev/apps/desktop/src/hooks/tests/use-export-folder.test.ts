/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExportFolder } from "../useExportFolder";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

vi.mock("@/platform/services", () => ({ useVaultRootService: () => ({ pickFolder }) }));

const TITLE = "Save the vault .zip in";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  pickFolder.mockReset();
});

describe("useExportFolder", () => {
  it("keeps the picked folder and offers it on the next pick", async () => {
    pickFolder.mockResolvedValue(" /media/usb ");
    const { result } = renderHook(() => useExportFolder(TITLE));
    expect(result.current.path).toBe("");

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.path).toBe("/media/usb"));
    expect(result.current.picking).toBe(false);

    act(() => result.current.choose());
    expect(pickFolder).toHaveBeenLastCalledWith("/media/usb", TITLE);
  });

  it("keeps the folder when the picker is cancelled", async () => {
    pickFolder.mockResolvedValueOnce("/media/usb").mockResolvedValueOnce(null);
    const { result } = renderHook(() => useExportFolder(TITLE));

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.path).toBe("/media/usb"));
    act(() => result.current.choose());
    await waitFor(() => expect(result.current.picking).toBe(false));
    expect(result.current.path).toBe("/media/usb");
  });

  it("reports a picker failure until the folder is typed", async () => {
    pickFolder.mockRejectedValue(new Error("dialog"));
    const { result } = renderHook(() => useExportFolder(TITLE));

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.pickFailed).toBe(true));
    expect(result.current.path).toBe("");
    act(() => result.current.setPath("/media/usb"));
    expect(result.current.pickFailed).toBe(false);
  });

  it("drops a pick that answers after the window closed", async () => {
    const pick = deferred<string | null>();
    pickFolder.mockReturnValue(pick.promise);
    const { result } = renderHook(() => useExportFolder(TITLE));

    act(() => result.current.choose());
    act(() => result.current.cancelPick());
    await act(async () => {
      pick.resolve("/media/usb");
    });
    expect(result.current.path).toBe("");
  });

  it("takes a typed folder as it is, and offers it trimmed to the picker", () => {
    pickFolder.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useExportFolder(TITLE));

    act(() => result.current.setPath("/media/My Copies "));
    expect(result.current.path).toBe("/media/My Copies ");
    act(() => result.current.choose());
    expect(pickFolder).toHaveBeenLastCalledWith("/media/My Copies", TITLE);
  });

  it("opens the picker from the field before it only while no folder is set", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const { result } = renderHook(() => useExportFolder(TITLE));

    let missing = false;
    act(() => {
      missing = result.current.chooseIfMissing();
    });
    expect(missing).toBe(true);
    expect(pickFolder).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.path).toBe("/media/usb"));

    act(() => {
      missing = result.current.chooseIfMissing();
    });
    expect(missing).toBe(false);
    expect(pickFolder).toHaveBeenCalledOnce();
  });

  it("opens one picker at a time", () => {
    pickFolder.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useExportFolder(TITLE));

    act(() => {
      result.current.chooseIfMissing();
      result.current.chooseIfMissing();
      result.current.choose();
    });
    expect(pickFolder).toHaveBeenCalledOnce();
  });

  it("keeps the folder when the window closes", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const { result } = renderHook(() => useExportFolder(TITLE));

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.path).toBe("/media/usb"));
    act(() => result.current.cancelPick());
    expect(result.current.path).toBe("/media/usb");
  });
});
