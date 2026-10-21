/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDataFolderExportDestination } from "../hooks/useDataFolderExportDestination";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/platform/services", () => ({ useVaultRootService: () => ({ pickFolder }) }));

afterEach(() => {
  pickFolder.mockReset();
});

describe("useDataFolderExportDestination", () => {
  it("picks its folder under the data folder zip title", () => {
    pickFolder.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.folder.choose());
    expect(pickFolder).toHaveBeenLastCalledWith(null, "modal.data_folder_export.picker_title");
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

  it("keeps the folder when the name starts over", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const { result } = renderHook(() => useDataFolderExportDestination());

    act(() => result.current.folder.choose());
    await waitFor(() => expect(result.current.folder.path).toBe("/media/usb"));
    act(() => result.current.resetZipName());
    expect(result.current.folder.path).toBe("/media/usb");
  });
});
