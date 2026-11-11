/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordWeaknessNotice } from "../PasswordWeaknessNotice";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));

afterEach(cleanup);

describe("PasswordWeaknessNotice", () => {
  it.each(["too_short", "predictable", "common", "public", "current"] as const)(
    "says what %s means",
    (weakness) => {
      render(createElement(PasswordWeaknessNotice, { weakness }));
      expect(screen.getByText(`password_weakness.${weakness}`)).toBeTruthy();
    },
  );

  it("shows nothing when nothing is wrong, and keeps its place for screen readers", () => {
    const { container } = render(
      createElement(PasswordWeaknessNotice, { weakness: null, id: "n" }),
    );
    const region = container.querySelector("#n");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");
  });
});
