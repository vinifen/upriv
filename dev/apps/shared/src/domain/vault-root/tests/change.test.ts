import { describe, expect, it } from "vitest";
import type { FolderSwitch } from "../../folder-lists";
import { dataFolderChangeMessage } from "../change";

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const SWITCH: FolderSwitch = {
  list: "data_folder",
  level: "app",
  from: { kind: "row", number: 1, name: "USB" },
  to: { kind: "fixed", choice: "default" },
  reason: "missing",
  saved: true,
};

describe("dataFolderChangeMessage", () => {
  it("says nothing when nothing changed", () => {
    expect(dataFolderChangeMessage(null, [], t)).toBeNull();
  });

  it("names the switch, then the vaults that closed with the lost data folder", () => {
    const message = dataFolderChangeMessage(SWITCH, ["Notes", "Work"], t);
    expect(message).toMatch(/^folder_list\./);
    expect(message).toContain('modal.vault_root_setup.sessions_ended {"names":"Notes, Work"}');
  });

  it("names the vaults that closed when the selection stayed", () => {
    expect(dataFolderChangeMessage(null, ["Notes"], t)).toBe(
      'modal.vault_root_setup.sessions_ended {"names":"Notes"}',
    );
  });
});
