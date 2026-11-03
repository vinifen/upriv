import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { ROW_ROLE_GUARD_MS } from "@upriv/shared";

/**
 * A Stop ignores presses in its first `ROW_ROLE_GUARD_MS` (`JobStopButton`).
 * Press it the way a person does: after that.
 */
export function pressStop(button: HTMLElement): void {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + ROW_ROLE_GUARD_MS);
  try {
    fireEvent.click(button);
  } finally {
    clock.mockRestore();
  }
}
