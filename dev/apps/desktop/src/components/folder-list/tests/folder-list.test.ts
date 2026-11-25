/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  NOTHING_SELECTED,
  VAULT_BACKUP_LIST,
  selectionHere,
  type AppBackupChoice,
  type AppUnlockedChoice,
  type DeviceGroups,
  type HereDevice,
  type VaultBackupChoice,
} from "@upriv/shared";
import { DeviceNamesProvider } from "@upriv/shared/react";
import { FolderList, type FolderListProps } from "../FolderList";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
    locale: "en",
  }),
}));

const HERE: HereDevice = { id: "a".repeat(32), system: "linux" };
/** Another device; its name ends in the start of its ID, `bbbbb`. */
const DESK = "b".repeat(32);
/** A phone; its name ends in `ccccc`. */
const PHONE = "c".repeat(32);

/** This device keeps two backup rows, `First` selected. */
const HERE_ONLY: DeviceGroups<AppBackupChoice> = {
  [HERE.id]: {
    system: "linux",
    selected: 1,
    next_number: 3,
    rows: [
      { number: 1, name: "First", path: "/media/first" },
      { number: 2, name: "Second", path: "/media/second" },
    ],
  },
};

const WITH_OTHERS: DeviceGroups<AppBackupChoice> = {
  ...HERE_ONLY,
  [DESK]: {
    system: "windows",
    selected: 1,
    next_number: 2,
    rows: [{ number: 1, name: "Drive", path: "D:\\Backups" }],
  },
  [PHONE]: {
    system: "android",
    selected: "data_folder",
    next_number: 2,
    rows: [
      {
        number: 1,
        name: "Card",
        path: "content://com.android.externalstorage.documents/tree/1234-5678%3AUpriv",
      },
    ],
  },
};

/** The list as a window holds it: every change is the next draft. */
function Harness({
  initial,
  rowInUse,
  markUnsaved,
}: {
  initial: DeviceGroups<AppBackupChoice>;
  rowInUse?: FolderListProps<AppBackupChoice>["rowInUse"];
  markUnsaved?: boolean;
}) {
  const [groups, setGroups] = useState(initial);
  return createElement(FolderList<AppBackupChoice>, {
    rowInUse,
    markUnsaved,
    label: "Backups",
    policy: APP_BACKUP_LIST,
    groups,
    saved: initial,
    here: HERE,
    fixed: [{ choice: "data_folder", title: "folder_list.choice.data_folder" }],
    pickFolder: async () => null,
    onChange: setGroups,
  });
}

/** This device's radio for the choice labelled `label`. */
function radio(label: string): HTMLInputElement {
  const group = screen.getByRole("radiogroup");
  const input = within(group).getByText(label).closest("label")?.querySelector("input[type=radio]");
  if (!(input instanceof HTMLInputElement)) throw new Error(`no radio for ${label}`);
  return input;
}

/** The card of a row of this device, by its label. */
function card(label: string): HTMLElement {
  const group = screen.getByRole("radiogroup");
  const element = within(group).getByText(label).closest("label")?.parentElement?.parentElement;
  if (!element) throw new Error(`no card for ${label}`);
  return element;
}

/**
 * Opens the ⋯ menu of the row labelled `label` and returns that menu. By its
 * id: a menu that just closed still fades out, and the popover stays hidden
 * until a real layout positions it, so its items are found by text.
 */
function openMenu(label: string): HTMLElement {
  const trigger = screen.getByRole("button", { name: `action.row_options ${label}` });
  fireEvent.click(trigger);
  const menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!menu) throw new Error(`no menu for ${label}`);
  return menu;
}

/** An item of an open menu, by its label. */
function item(menu: HTMLElement, label: string): HTMLButtonElement {
  const button = within(menu).getByText(label).closest("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no item ${label}`);
  return button;
}

/** Chooses `action` in the ⋯ menu of the row labelled `label`. */
function choose(label: string, action: string) {
  fireEvent.click(item(openMenu(label), action));
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe("FolderList", () => {
  it("is one radio group, the fixed choice on top, the rows below it in order", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    const group = screen.getByRole("radiogroup", { name: "Backups" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radio("First").checked).toBe(true);
    expect(radios).toEqual([
      radio("folder_list.choice.data_folder"),
      radio("First"),
      radio("Second"),
    ]);
  });

  it("marks the choice a device with nothing chosen uses as Default, whatever is selected", () => {
    /** Whether the choice labelled `title` wears the Default badge. */
    const isDefault = (title: string) => {
      const choice = screen.getByText(title).closest("label");
      if (!choice) throw new Error(`no choice ${title}`);
      return within(choice).queryByText("modal.settings.badge.default") !== null;
    };
    render(createElement(Harness, { initial: HERE_ONLY }));
    expect(radio("First").checked).toBe(true);
    expect(isDefault("folder_list.choice.data_folder")).toBe(true);
    expect(screen.getAllByText("modal.settings.badge.default")).toHaveLength(1);
    cleanup();

    // A vault's backups: Use the app's is its default, Data folder is not.
    render(
      createElement(FolderList<VaultBackupChoice>, {
        label: "Vault backups",
        policy: VAULT_BACKUP_LIST,
        groups: {},
        saved: {},
        here: HERE,
        fixed: [
          { choice: "inherit", title: "Use the app's" },
          { choice: "data_folder", title: "Data folder" },
        ],
        pickFolder: async () => null,
        onChange: () => {},
      }),
    );
    expect(isDefault("Use the app's")).toBe(true);
    expect(isDefault("Data folder")).toBe(false);
    cleanup();

    // The app's unlocked folders start with nothing chosen: no choice is Default.
    render(
      createElement(FolderList<AppUnlockedChoice>, {
        label: "Unlocked",
        policy: APP_UNLOCKED_LIST,
        groups: {},
        saved: {},
        here: HERE,
        fixed: [{ choice: "beside", title: "Beside" }],
        pickFolder: async () => null,
        onChange: () => {},
      }),
    );
    expect(screen.queryByText("modal.settings.badge.default")).toBeNull();
  });

  it("selects with a row's radio part", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    fireEvent.click(radio("Second"));
    expect(radio("Second").checked).toBe(true);
    expect(radio("First").checked).toBe(false);
  });

  it("edits, moves, and deletes from a row's menu, which never selects it", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));

    choose("Second", "folder_list.action.edit");
    expect(radio("First").checked).toBe(true);
    expect(within(card("Second")).getByLabelText("folder_list.field.name")).toBeDefined();

    choose("Second", "folder_list.action.move_up");
    expect(radio("First").checked).toBe(true);
    expect(screen.getAllByRole("radio")[1]).toBe(radio("Second"));

    choose("Second", "folder_list.action.delete");
    expect(within(screen.getByRole("radiogroup")).queryByText("Second")).toBeNull();
    expect(radio("First").checked).toBe(true);
  });

  it("offers each move only where the row can go", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    const first = openMenu("First");
    expect(item(first, "folder_list.action.move_up").disabled).toBe(true);
    expect(item(first, "folder_list.action.move_down").disabled).toBe(false);
    // A folder of this computer opens in its file manager.
    expect(item(first, "action.open_folder").disabled).toBe(false);
  });

  it("keeps each edit in the draft as typed, and Edit again closes the fields", async () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    choose("Second", "folder_list.action.edit");
    fireEvent.change(within(card("Second")).getByLabelText("folder_list.field.path"), {
      target: { value: "/media/other" },
    });
    expect(within(card("Second")).getByText("/media/other")).toBeDefined();
    // The fields have no button of their own: the window's Save writes them.
    expect(within(card("Second")).queryByRole("button", { name: /done/i })).toBeNull();

    const edit = item(openMenu("Second"), "folder_list.action.edit");
    expect(edit.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(edit);
    await waitFor(() =>
      expect(within(card("Second")).queryByLabelText("folder_list.field.path")).toBeNull(),
    );
    expect(within(card("Second")).getByText("/media/other")).toBeDefined();
  });

  it("marks a row whose problem holds the save, selected or not", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    choose("Second", "folder_list.action.edit");
    fireEvent.change(within(card("Second")).getByLabelText("folder_list.field.path"), {
      target: { value: "relative" },
    });
    expect(radio("First").checked).toBe(true);
    expect(within(card("Second")).getByText("folder_list.problem.not_absolute")).toBeDefined();
    expect(card("Second").className).toContain("vault-status-recovery");
    expect(card("First").className).not.toContain("vault-status-recovery");
  });

  it("keeps the delete and the path of a row an open vault uses, and says why", () => {
    render(
      createElement(Harness, {
        initial: HERE_ONLY,
        rowInUse: (row) => row.number === 2,
      }),
    );
    const second = card("Second");
    const menu = openMenu("Second");
    expect(item(menu, "folder_list.action.delete").disabled).toBe(true);
    expect(within(menu).getByText("folder_list.row.in_use")).toBeDefined();

    fireEvent.click(item(menu, "folder_list.action.edit"));
    expect(within(second).getByLabelText("folder_list.field.path")).toHaveProperty(
      "readOnly",
      true,
    );
    expect(within(second).queryByRole("button", { name: "folder_list.action.browse" })).toBeNull();
    expect(within(second).getByText("folder_list.row.in_use")).toBeDefined();
    // Its name can still change, and the other row keeps its delete.
    expect(within(second).getByLabelText("folder_list.field.name")).toHaveProperty(
      "readOnly",
      false,
    );
    expect(item(openMenu("First"), "folder_list.action.delete").disabled).toBe(false);
  });

  it("marks a new or edited row as not saved, and a moved one not", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    const badge = (label: string) =>
      within(card(label)).queryByText("folder_list.badge.unsaved") !== null;
    expect(badge("First") || badge("Second")).toBe(false);

    choose("Second", "folder_list.action.move_up");
    expect(badge("First") || badge("Second")).toBe(false);

    choose("First", "folder_list.action.edit");
    fireEvent.change(within(card("First")).getByLabelText("folder_list.field.name"), {
      target: { value: "First drive" },
    });
    expect(badge("First drive")).toBe(true);
    expect(badge("Second")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "folder_list.action.add" }));
    expect(badge("folder_list.row.unnamed 3")).toBe(true);
  });

  it("marks nothing as not saved where nothing is saved yet", () => {
    render(createElement(Harness, { initial: HERE_ONLY, markUnsaved: false }));
    fireEvent.click(screen.getByRole("button", { name: "folder_list.action.add" }));
    expect(screen.queryByText("folder_list.badge.unsaved")).toBeNull();
  });

  it("selects the next row when the selected one is deleted", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    choose("First", "folder_list.action.delete");
    expect(radio("Second").checked).toBe(true);
  });

  it("adds a folder selected and open to take its path, which the row then asks for", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    fireEvent.click(screen.getByRole("button", { name: "folder_list.action.add" }));
    const added = card("folder_list.row.unnamed 3");
    expect(radio("folder_list.row.unnamed 3").checked).toBe(true);
    expect(within(added).getByText("folder_list.problem.empty")).toBeDefined();
    expect(within(added).getByLabelText("folder_list.field.path")).toBe(document.activeElement);
  });

  it("puts Add folder at the bottom, so a new row opens last, right above it", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const add = () => screen.getByRole("button", { name: "folder_list.action.add" });
    expect(follows(radio("folder_list.choice.data_folder"), radio("First"))).toBe(true);
    expect(follows(radio("Second"), add())).toBe(true);

    fireEvent.click(add());
    const added = radio("folder_list.row.unnamed 3");
    expect(screen.getAllByRole("radio").at(-1)).toBe(added);
    expect(follows(added, add())).toBe(true);
  });

  it("marks every choice and says why while the window needs one and nothing is selected", () => {
    function Unlocked() {
      const [groups, setGroups] = useState<DeviceGroups<AppUnlockedChoice>>({});
      const unchosen = selectionHere(groups, HERE.id, APP_UNLOCKED_LIST) === NOTHING_SELECTED;
      return createElement(FolderList<AppUnlockedChoice>, {
        label: "Unlocked",
        policy: APP_UNLOCKED_LIST,
        groups,
        saved: {},
        here: HERE,
        fixed: [{ choice: "beside", title: "Beside" }],
        selectionMissing: unchosen ? "Choose a folder" : null,
        pickFolder: async () => null,
        onChange: setGroups,
      });
    }
    render(createElement(Unlocked));
    // The card wraps the choice's radio label and the step it may still need.
    const besideCard = () =>
      screen.getByText("Beside").closest("label")?.parentElement?.className ?? "";
    expect(screen.getByRole("status").textContent).toBe("Choose a folder");
    expect(besideCard()).toContain("vault-status-recovery");

    fireEvent.click(radio("Beside"));
    expect(screen.queryByText("Choose a folder")).toBeNull();
    expect(besideCard()).not.toContain("vault-status-recovery");
  });

  it("shows no device header with only this device", () => {
    render(createElement(Harness, { initial: HERE_ONLY }));
    expect(screen.queryByText("folder_list.this_device")).toBeNull();
    expect(screen.queryByText("folder_list.other_devices")).toBeNull();
  });

  it("names each device by its system and the start of its ID once another device has a group", () => {
    render(createElement(Harness, { initial: WITH_OTHERS }));
    expect(screen.getByText("folder_list.this_device")).toBeDefined();
    expect(screen.getByText("device.name device.system.linux aaaaa")).toBeDefined();
    expect(screen.getByText("folder_list.other_devices")).toBeDefined();
    // Collapsed, a device says what it selects.
    const desk = screen.getByRole("button", { name: "device.name device.system.windows bbbbb" });
    expect(desk.getAttribute("aria-expanded")).toBe("false");
    expect(desk.textContent).toContain("folder_list.selected_there Drive");
    // Other devices have no radio: only the device in use chooses.
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});

describe("OtherDevices", () => {
  function expand(label: RegExp) {
    fireEvent.click(screen.getByRole("button", { name: label }));
  }

  it("names each device by the OS name it wrote, and this one by its OS now", () => {
    render(
      createElement(DeviceNamesProvider, {
        names: { [DESK]: "Windows 11 Pro", [HERE.id]: "Ubuntu 22.04.4 LTS" },
        here: { ...HERE, os: "Ubuntu 24.04.5 LTS" },
        children: createElement(Harness, { initial: WITH_OTHERS }),
      }),
    );
    expect(screen.getByRole("button", { name: /Windows 11 Pro.*bbbbb/ })).toBeDefined();
    expect(screen.getByText(/Ubuntu 24\.04\.5 LTS.*aaaaa/)).toBeDefined();
    expect(screen.queryByText(/Ubuntu 22\.04/)).toBeNull();
    // A device that wrote no name is named by its system.
    expect(screen.getByRole("button", { name: /device\.system\.android.*ccccc/ })).toBeDefined();
  });

  it("copies a row into this device, selected, keeping its name", () => {
    const linuxDesk: DeviceGroups<AppBackupChoice> = {
      ...HERE_ONLY,
      [DESK]: {
        system: "linux",
        selected: 1,
        next_number: 2,
        rows: [{ number: 1, name: "Shared", path: "/mnt/shared" }],
      },
    };
    render(createElement(Harness, { initial: linuxDesk }));
    expand(/bbbbb/);
    choose("Shared", "folder_list.action.copy");
    expect(radio("Shared").checked).toBe(true);
  });

  it("refuses a copy of a path this device cannot hold, and offers none from a phone", () => {
    render(createElement(Harness, { initial: WITH_OTHERS }));
    expand(/bbbbb/);
    const drive = openMenu("Drive");
    expect(item(drive, "folder_list.action.copy").disabled).toBe(true);
    expect(within(drive).getByText("folder_list.copy.not_valid_here")).toBeDefined();

    expand(/ccccc/);
    // A phone's tree shows where it is, not its address.
    expect(screen.getByText("1234-5678/Upriv")).toBeDefined();
    expect(screen.getByText("folder_list.copy.phone_row")).toBeDefined();
    expect(within(openMenu("Card")).queryByText("folder_list.action.copy")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /folder_list.action.copy_all/ })).toHaveLength(
      1,
    );
  });

  it("marks another device whose row holds the save, collapsed or not", () => {
    render(createElement(Harness, { initial: WITH_OTHERS }));
    const device = () =>
      screen.getByRole("button", { name: /bbbbb/ }).parentElement?.className ?? "";
    expect(device()).not.toContain("vault-status-recovery");
    expand(/bbbbb/);
    choose("Drive", "folder_list.action.edit");
    const others = within(screen.getByRole("region", { name: "folder_list.other_devices" }));
    fireEvent.change(others.getByLabelText("folder_list.field.path"), {
      target: { value: "relative" },
    });
    expect(screen.getByText("folder_list.problem.not_absolute")).toBeDefined();
    expect(device()).toContain("vault-status-recovery");
    expand(/bbbbb/);
    expect(device()).toContain("vault-status-recovery");
  });

  it("keeps a device whose last folder is deleted", () => {
    render(createElement(Harness, { initial: WITH_OTHERS }));
    expand(/bbbbb/);
    choose("Drive", "folder_list.action.delete");
    const desk = screen.getByRole("button", { name: /bbbbb/ });
    expect(desk.textContent).toContain("folder_list.selected_there folder_list.choice.data_folder");
    expect(screen.getByText("folder_list.device_no_folders")).toBeDefined();
  });

  it("removes another device from the list after asking, naming the vaults' lists", () => {
    render(createElement(Harness, { initial: WITH_OTHERS }));
    expand(/bbbbb/);
    fireEvent.click(screen.getByRole("button", { name: "folder_list.action.remove_device" }));
    // An app list's removal reaches every vault's own list.
    const question = screen.getByText(/folder_list.remove_device_confirm_app/);
    const strip = question.parentElement;
    if (!strip) throw new Error("no confirmation");
    fireEvent.click(
      within(strip).getByRole("button", { name: "folder_list.action.remove_device" }),
    );
    expect(screen.queryByRole("button", { name: /bbbbb/ })).toBeNull();
  });
});
