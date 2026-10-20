/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDataFolderExportDestination } from "../hooks/useDataFolderExportDestination";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/platform/services", () => ({ useVaultRootService: () => ({ pickFolder }) }));

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

describe("useDataFolderExportDestination", () => {
  it("keeps the picked folder and offers it on the next pick", async () => {
    pickFolder.mockResolvedValue(" /media/usb ");
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.destDir).toBe("/media/usb"));
    expect(result.current.picking).toBe(false);

    act(() => result.current.choose());
    expect(pickFolder).toHaveBeenLastCalledWith(
      "/media/usb",
      "modal.data_folder_export.picker_title",
    );
  });

  it("keeps the folder when the picker is cancelled", async () => {
    pickFolder.mockResolvedValueOnce("/media/usb").mockResolvedValueOnce(null);
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.destDir).toBe("/media/usb"));
    act(() => result.current.choose());
    await waitFor(() => expect(result.current.picking).toBe(false));
    expect(result.current.destDir).toBe("/media/usb");
  });

  it("reports a picker failure", async () => {
    pickFolder.mockRejectedValue(new Error("dialog"));
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.pickFailed).toBe(true));
    expect(result.current.destDir).toBeNull();
  });

  it("drops a pick that answers after the window closed", async () => {
    const pick = deferred<string | null>();
    pickFolder.mockReturnValue(pick.promise);
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.choose());
    act(() => result.current.cancelPick());
    await act(async () => {
      pick.resolve("/media/usb");
    });
    expect(result.current.destDir).toBeNull();
  });

  it("starts the name from the clock in UTC and resets it to the time of the reset", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 19, 10, 15, 0)));
      const { result } = renderHook(() => useDataFolderExportDestination());
      expect(result.current.zipName).toBe("upriv-2026-10-19-101500");

      act(() => result.current.setZipName("trip copy"));
      expect(result.current.zipName).toBe("trip copy");

      vi.setSystemTime(new Date(Date.UTC(2026, 9, 19, 11, 0, 9)));
      act(() => result.current.resetZipName());
      expect(result.current.zipName).toBe("upriv-2026-10-19-110009");
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a typed folder as it is, and offers it to the picker", () => {
    pickFolder.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.setDestDir("/media/My Copies "));
    expect(result.current.destDir).toBe("/media/My Copies ");
    act(() => result.current.choose());
    expect(pickFolder).toHaveBeenLastCalledWith(
      "/media/My Copies",
      "modal.data_folder_export.picker_title",
    );
  });

  it("keeps the folder after an export and when the window closes", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.choose());
    await waitFor(() => expect(result.current.destDir).toBe("/media/usb"));
    act(() => result.current.resetZipName());
    expect(result.current.destDir).toBe("/media/usb");
    act(() => result.current.cancelPick());
    expect(result.current.destDir).toBe("/media/usb");
  });
});
