/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLDER_PATH_CHECK_DELAY_MS } from "@upriv/shared";
import { useFolderStatuses } from "@upriv/shared/react";

/** Lets the pause pass and every answer land. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(FOLDER_PATH_CHECK_DELAY_MS);
  });
}

function hook(check: (path: string) => Promise<string>) {
  return renderHook(({ paths }: { paths: string[] }) => useFolderStatuses(paths, check), {
    initialProps: { paths: ["/media/a"] },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFolderStatuses", () => {
  it("reads checking from the first key, and asks once the path settles", async () => {
    const check = vi.fn(async (path: string) => `ok ${path}`);
    const { result } = hook(check);
    expect(result.current.statuses.get("/media/a")).toBeNull();
    expect(check).not.toHaveBeenCalled();

    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current.statuses.get("/media/a")).toBe("ok /media/a");
  });

  it("checks a path again when it comes back after an edit", async () => {
    const check = vi.fn(async (path: string) => `ok ${path}`);
    const { result, rerender } = hook(check);
    await settle();

    // A letter typed and taken back: the path leaves the list and returns.
    rerender({ paths: ["/media/ab"] });
    rerender({ paths: ["/media/a"] });
    expect(result.current.statuses.get("/media/a")).toBeNull();
    await settle();
    expect(result.current.statuses.get("/media/a")).toBe("ok /media/a");
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("checks a path again when it comes back before its first answer", async () => {
    let answer: (status: string) => void = () => {};
    const check = vi.fn((path: string) =>
      path === "/media/a" && check.mock.calls.length === 1
        ? new Promise<string>((resolve) => (answer = resolve))
        : Promise.resolve(`ok ${path}`),
    );
    const { result, rerender } = hook(check);
    await settle();

    rerender({ paths: ["/media/ab"] });
    await act(async () => answer("late"));
    rerender({ paths: ["/media/a"] });
    await settle();
    expect(result.current.statuses.get("/media/a")).toBe("ok /media/a");
  });

  it("leaves out a path whose check cannot run, until retry asks again", async () => {
    let fail = true;
    const check = vi.fn(async (path: string) => {
      if (fail) throw new Error("no answer");
      return `ok ${path}`;
    });
    const { result } = hook(check);
    await settle();
    expect(result.current.statuses.has("/media/a")).toBe(false);

    fail = false;
    act(() => result.current.retry());
    expect(result.current.statuses.get("/media/a")).toBeNull();
    await settle();
    expect(result.current.statuses.get("/media/a")).toBe("ok /media/a");
  });
});
