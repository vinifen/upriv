/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createEmptyCreateVaultDraft,
  type CreateVaultDraft,
  type CreateVaultStepId,
} from "@upriv/shared";
import { renderCreateVaultStep } from "../createVaultSteps";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/platform/services", () => ({
  useCreateVaultService: () => ({}),
  useVaultRootService: () => ({}),
}));

const LOCK_NOTICE = "vault.create.settings_locked";

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

function sevenZip(overrides: Partial<CreateVaultDraft> = {}): CreateVaultDraft {
  return {
    ...createEmptyCreateVaultDraft([]),
    source: "import",
    importFileName: "Notes.7z",
    importFilePath: "/tmp/Notes.7z",
    displayName: "Notes",
    ...overrides,
  };
}

function show(step: CreateVaultStepId, draft: CreateVaultDraft) {
  const onChange = vi.fn<(patch: Partial<CreateVaultDraft>) => void>();
  render(renderCreateVaultStep(step, { draft, errors: [], onChange }));
  return onChange;
}

function input(label: string): HTMLInputElement {
  return screen.getByLabelText(label);
}

/** A fieldset disables its controls without setting their own `disabled`. */
function isDisabled(label: string): boolean {
  return input(label).matches(":disabled");
}

function switchOn(label: string): boolean {
  return input(label).getAttribute("aria-checked") === "true";
}

describe("the .7z field locks", () => {
  afterEach(cleanup);

  it("locks the name and note, and says to test the password first", () => {
    show("identity", sevenZip());
    expect(screen.getByRole("status").textContent).toBe(LOCK_NOTICE);
    expect(isDisabled("vault.name.label")).toBe(true);
    expect(isDisabled("vault.create.note")).toBe(true);
  });

  it("unlocks them once the password test passes", () => {
    show("identity", sevenZip({ passwordValidated: true }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(isDisabled("vault.name.label")).toBe(false);
  });

  it("does not lock when this file's settings are turned off", () => {
    show("identity", sevenZip({ importKeepSettings: false }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(isDisabled("vault.name.label")).toBe(false);
  });

  it("does not lock another import", () => {
    show("identity", sevenZip({ importFileName: "Notes plain text.zip", zipLayout: "files" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(isDisabled("vault.name.label")).toBe(false);
  });

  it("keeps the sections open and the group fields usable", () => {
    show("general", sevenZip());
    expect(screen.getByRole("status").textContent).toBe(LOCK_NOTICE);
    for (const title of [
      "modal.settings.section.kdf",
      "modal.settings.section.backup",
      "modal.settings.section.auto_close",
    ]) {
      const section = screen.getByRole("button", { name: title }) as HTMLButtonElement;
      expect(section.disabled).toBe(false);
    }
    const group = screen.getByRole("button", {
      name: "vault.group.assignment.section",
    }) as HTMLButtonElement;
    expect(group.disabled).toBe(false);
    const locked = document.querySelectorAll("fieldset:disabled");
    expect(locked.length).toBe(3);
    expect(isDisabled("modal.settings.field.group.new_name")).toBe(false);
  });

  it("locks the hint on the password step and leaves the password itself open", () => {
    show("password", sevenZip());
    expect(isDisabled("vault.create.password_hint")).toBe(true);
    expect(screen.getByText("vault.create.password_hint_locked")).toBeDefined();
    expect(isDisabled("vault.create.password")).toBe(false);
  });

  it("says what the password test found", () => {
    show(
      "password",
      sevenZip({ passwordValidated: true, importCarriesSettings: true, password: "secret" }),
    );
    expect(screen.getByRole("status").textContent).toBe("vault.create.password_settings_read");
    cleanup();
    show("password", sevenZip({ passwordValidated: true, password: "secret" }));
    expect(screen.getByRole("status").textContent).toBe("vault.create.password_no_settings");
    expect(isDisabled("vault.create.password_hint")).toBe(false);
  });
});

describe("the import switches", () => {
  afterEach(cleanup);

  it("offers both on a .7z, on by default", () => {
    const onChange = show("source", sevenZip());
    expect(switchOn("vault.create.keep_workspace")).toBe(true);
    fireEvent.click(input("vault.create.keep_settings"));
    expect(onChange).toHaveBeenCalledWith({ importKeepSettings: false });
  });

  it("offers on a .zip only what it carries", () => {
    show(
      "source",
      sevenZip({
        importFileName: "Notes plain text.zip",
        zipLayout: "files",
        importCarriesWorkspace: true,
      }),
    );
    expect(switchOn("vault.create.keep_workspace")).toBe(true);
    expect(screen.queryByLabelText("vault.create.keep_settings")).toBeNull();
  });

  it("offers nothing on an encrypted vault zip", () => {
    show("source", sevenZip({ importFileName: "Notes.zip", zipLayout: "store" }));
    expect(screen.queryByLabelText("vault.create.keep_workspace")).toBeNull();
    expect(screen.queryByLabelText("vault.create.keep_settings")).toBeNull();
  });
});
