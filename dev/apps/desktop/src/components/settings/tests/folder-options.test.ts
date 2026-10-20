/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appWorkspace,
  vaultWorkspace,
  type WorkspacePathIssue,
  type WorkspaceTable,
} from "@upriv/shared";
import { AppSettingsWorkspaceSection } from "@/features/system/settings/appSettingsForm";
import { VaultSettingsMountSection } from "../vaultSettingsForm";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/platform/services", () => ({ useVaultRootService: () => ({ pickFolder }) }));

const PLACEHOLDER = "modal.folder_field.placeholder";

function radio(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) throw new Error(`no ${value} radio`);
  return input;
}

/** The option's card wears the attention border: chosen and a step is left. */
function needsStep(value: string): boolean {
  return radio(value).closest("label")?.className.includes("vault-status-recovery") ?? false;
}

function VaultFolders({
  plaintext,
  onPathIssue,
}: {
  plaintext: boolean;
  onPathIssue: (issue: WorkspacePathIssue | null) => void;
}) {
  const [config, setConfig] = useState<WorkspaceTable>(vaultWorkspace());
  return createElement(VaultSettingsMountSection, {
    config,
    onChange: (patch) => setConfig((current) => ({ ...current, ...patch })),
    onPathIssueChange: onPathIssue,
    plaintext,
    appWorkspace: appWorkspace(),
  });
}

function AppFolders() {
  const [config, setConfig] = useState<WorkspaceTable>(appWorkspace());
  return createElement(AppSettingsWorkspaceSection, {
    config,
    onChange: (patch) => setConfig((current) => ({ ...current, ...patch })),
  });
}

afterEach(() => {
  cleanup();
  pickFolder.mockReset();
});

describe.each([
  ["an encrypted vault", false],
  ["a plain text vault", true],
])("vault folder options for %s", (_label, plaintext) => {
  it("chooses Another folder without opening the picker, and holds Save until it has a path", () => {
    const onPathIssue = vi.fn();
    render(createElement(VaultFolders, { plaintext, onPathIssue }));

    fireEvent.click(radio("custom"));
    expect(pickFolder).not.toHaveBeenCalled();
    expect(radio("custom").checked).toBe(true);
    expect(needsStep("custom")).toBe(true);
    expect(onPathIssue).toHaveBeenLastCalledWith("empty");

    const field = screen.getByPlaceholderText<HTMLInputElement>(PLACEHOLDER);
    fireEvent.change(field, { target: { value: "/media/My Notes" } });
    expect(field.value).toBe("/media/My Notes");
    expect(needsStep("custom")).toBe(false);
    expect(onPathIssue).toHaveBeenLastCalledWith(null);

    // Emptied again, it stays chosen and waits for the path.
    fireEvent.change(field, { target: { value: "" } });
    expect(radio("custom").checked).toBe(true);
    expect(onPathIssue).toHaveBeenLastCalledWith("empty");

    fireEvent.click(radio("inherit"));
    expect(radio("inherit").checked).toBe(true);
    expect(onPathIssue).toHaveBeenLastCalledWith(null);
  });
});

describe("app workspace options", () => {
  it("chooses a custom folder without opening the picker, and keeps it chosen while empty", () => {
    render(createElement(AppFolders));

    fireEvent.click(radio("custom"));
    expect(pickFolder).not.toHaveBeenCalled();
    expect(needsStep("custom")).toBe(true);
    expect(screen.getByText("modal.workspace.error.empty")).toBeDefined();

    const field = screen.getByPlaceholderText<HTMLInputElement>(PLACEHOLDER);
    fireEvent.change(field, { target: { value: "/media/work" } });
    expect(needsStep("custom")).toBe(false);

    fireEvent.change(field, { target: { value: "" } });
    expect(radio("custom").checked).toBe(true);
    expect(needsStep("custom")).toBe(true);
  });
});
