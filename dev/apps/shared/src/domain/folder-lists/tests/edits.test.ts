import { describe, expect, it } from "vitest";
import {
  addRow,
  copyAll,
  copyRefusal,
  copyRow,
  deleteRow,
  hasOtherDevices,
  moveRow,
  normalizeRowName,
  otherGroups,
  removeGroup,
  selectHere,
  updateRow,
  type HereDevice,
} from "../edits";
import { isEmptyListChanges, listChanges, rowProblems, rowUnsaved } from "../changes";
import { parseDeviceGroups } from "../normalize";
import {
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  DATA_FOLDER_LIST,
  ROW_NAME_MAX_CHARS,
  VAULT_BACKUP_LIST,
  type DeviceGroups,
} from "../types";

const here: HereDevice = { id: "a".repeat(32), system: "linux" };
const laptop = "b".repeat(32);
const phone = "c".repeat(32);

function withRows(paths: string[]) {
  let groups: DeviceGroups<"data_folder"> = {};
  for (const path of paths) groups = addRow(groups, here, APP_BACKUP_LIST, path).groups;
  return groups;
}

describe("folder list edits", () => {
  it("numbers rows once and selects a row added here", () => {
    const groups = withRows(["/mnt/a", "/mnt/b"]);
    const group = groups[here.id];
    expect(group.rows.map((row) => row.number)).toEqual([1, 2]);
    expect(group.selected).toBe(2);
    const deleted = deleteRow(groups, here.id, 2, APP_BACKUP_LIST);
    const again = addRow(deleted, here, APP_BACKUP_LIST, "/mnt/c");
    expect(again.number).toBe(3);
  });

  it("moves the selection to the top row left, then to the list's fallback", () => {
    let groups = withRows(["/mnt/a", "/mnt/b"]);
    groups = deleteRow(groups, here.id, 2, APP_BACKUP_LIST);
    expect(groups[here.id].selected).toBe(1);
    groups = deleteRow(groups, here.id, 1, APP_BACKUP_LIST);
    // A group that holds nothing is not kept.
    expect(groups[here.id]).toBeUndefined();

    let unlocked = addRow({}, here, APP_UNLOCKED_LIST, "/mnt/a").groups;
    unlocked = deleteRow(unlocked, here.id, 1, APP_UNLOCKED_LIST);
    expect(unlocked[here.id]).toBeUndefined();
  });

  it("keeps the order as the priority and never moves past the ends", () => {
    let groups = withRows(["/mnt/a", "/mnt/b", "/mnt/c"]);
    groups = moveRow(groups, here.id, 3, -1, APP_BACKUP_LIST);
    expect(groups[here.id].rows.map((row) => row.number)).toEqual([1, 3, 2]);
    expect(moveRow(groups, here.id, 1, -1, APP_BACKUP_LIST)).toEqual(groups);
  });

  it("keeps a fixed choice selected and drops a group back at its default", () => {
    const groups = selectHere({}, here, VAULT_BACKUP_LIST, "data_folder");
    expect(groups[here.id].selected).toBe("data_folder");
    expect(selectHere(groups, here, VAULT_BACKUP_LIST, "inherit")[here.id]).toBeUndefined();
  });

  it("shows devices only while another device has a group", () => {
    const groups = withRows(["/mnt/a"]);
    expect(hasOtherDevices(groups, here.id)).toBe(false);
    const both = { ...groups, [laptop]: { ...groups[here.id], system: "windows" as const } };
    expect(hasOtherDevices(both, here.id)).toBe(true);
    expect(hasOtherDevices(removeGroup(both, laptop), here.id)).toBe(false);
  });

  it("orders the other devices by system, then ID", () => {
    const one = withRows(["/mnt/a"])[here.id];
    const groups = {
      [phone]: { ...one, system: "windows" as const },
      [laptop]: { ...one, system: "windows" as const },
      ["d".repeat(32)]: { ...one, system: "android" as const },
      [here.id]: one,
    };
    expect(otherGroups(groups, here.id).map(([id]) => id)).toEqual(["d".repeat(32), laptop, phone]);
  });

  it("caps a row name", () => {
    expect(normalizeRowName(` ${"x".repeat(ROW_NAME_MAX_CHARS + 5)} `)).toHaveLength(
      ROW_NAME_MAX_CHARS,
    );
  });

  it("keeps a name as typed, so a space between words stays, and caps it", () => {
    const groups = withRows(["/mnt/a"]);
    const typed = updateRow(groups, here.id, 1, { name: "My " }, APP_BACKUP_LIST);
    expect(typed[here.id].rows[0].name).toBe("My ");
    const long = updateRow(groups, here.id, 1, { name: "x".repeat(90) }, APP_BACKUP_LIST);
    expect(long[here.id].rows[0].name).toHaveLength(ROW_NAME_MAX_CHARS);
  });
});

describe("copy between devices", () => {
  const groups: DeviceGroups<"default"> = parseDeviceGroups(
    {
      [laptop]: {
        system: "linux",
        selected: 2,
        next_number: 3,
        rows: [
          { number: 1, name: "USB", path: "/media/usb" },
          { number: 2, name: "", path: "/home/me/Upriv" },
        ],
      },
      [phone]: {
        system: "android",
        next_number: 2,
        rows: [{ number: 1, name: "", path: "content://x/tree/primary%3AUpriv" }],
      },
      ["d".repeat(32)]: {
        system: "windows",
        next_number: 2,
        rows: [{ number: 1, name: "", path: "D:\\Upriv" }],
      },
    },
    DATA_FOLDER_LIST,
  );

  it("copies one row with its name and selects it", () => {
    const copied = copyRow(groups, laptop, 1, here, DATA_FOLDER_LIST);
    expect(copied[here.id].rows).toEqual([{ number: 1, name: "USB", path: "/media/usb" }]);
    expect(copied[here.id].selected).toBe(1);
  });

  it("copies everything and selects what that device selected", () => {
    const copied = copyAll(groups, laptop, here, DATA_FOLDER_LIST);
    expect(copied[here.id].rows.map((row) => row.path)).toEqual(["/media/usb", "/home/me/Upriv"]);
    expect(copied[here.id].selected).toBe(2);
    // A path already here is skipped, and its selection follows it.
    const again = copyAll(copied, laptop, here, DATA_FOLDER_LIST);
    expect(again[here.id].rows).toHaveLength(2);
    expect(again[here.id].selected).toBe(2);
  });

  it("refuses what this device cannot hold", () => {
    const fromPhone = groups[phone];
    expect(copyRefusal(groups, fromPhone, fromPhone.rows[0], here, DATA_FOLDER_LIST)).toBe(
      "phone_row",
    );
    const work = groups["d".repeat(32)];
    expect(copyRefusal(groups, work, work.rows[0], here, DATA_FOLDER_LIST)).toBe("not_valid_here");
    const onPhone: HereDevice = { id: "e".repeat(32), system: "android" };
    const fromLaptop = groups[laptop];
    expect(copyRefusal(groups, fromLaptop, fromLaptop.rows[0], onPhone, DATA_FOLDER_LIST)).toBe(
      "phone_here",
    );
  });
});

describe("change sets", () => {
  it("sends only the parts that changed", () => {
    const before = withRows(["/mnt/a"]);
    expect(isEmptyListChanges(listChanges(before, before, here.id, APP_BACKUP_LIST))).toBe(true);
    const selected = selectHere(before, here, APP_BACKUP_LIST, "data_folder");
    expect(listChanges(before, selected, here.id, APP_BACKUP_LIST).groups[here.id]).toEqual({
      selected: "data_folder",
    });
  });

  it("removes another device's group and empties this device's", () => {
    const before = { ...withRows(["/mnt/a"]), [laptop]: withRows(["/mnt/b"])[here.id] };
    const changes = listChanges(before, {}, here.id, APP_BACKUP_LIST);
    expect(changes.groups[laptop]).toEqual({ remove: true });
    expect(changes.groups[here.id]).toEqual({ rows: [], next_number: 2, selected: "data_folder" });
  });

  it("checks the path rules only on rows a draft added or changed", () => {
    const before = parseDeviceGroups(
      {
        [here.id]: {
          system: "linux",
          next_number: 2,
          rows: [{ number: 1, name: "", path: "relative" }],
        },
      },
      APP_BACKUP_LIST,
    );
    const after = addRow(before, here, APP_BACKUP_LIST, "/mnt/upriv-unlocked/x").groups;
    const problems = rowProblems(before[here.id], after[here.id], APP_BACKUP_LIST);
    expect([...problems]).toEqual([[2, "overlap"]]);
    const repeated = addRow(after, here, APP_BACKUP_LIST, "/data").groups;
    expect(rowProblems(after[here.id], repeated[here.id], APP_BACKUP_LIST, ["/data/"]).get(3)).toBe(
      "duplicate",
    );
  });

  it("checks every row for a repeat once the rows change, as core does", () => {
    // A row saved before the data folder came to the same place.
    const before = withRows(["/data", "/mnt/b"]);
    const renamed = updateRow(before, here.id, 2, { name: "Drive" }, APP_BACKUP_LIST);
    expect([...rowProblems(before[here.id], renamed[here.id], APP_BACKUP_LIST, ["/data"])]).toEqual(
      [[1, "duplicate"]],
    );
    // A change of the selection alone sends no rows: nothing to refuse.
    const selected = selectHere(before, here, APP_BACKUP_LIST, 2);
    expect(rowProblems(before[here.id], selected[here.id], APP_BACKUP_LIST, ["/data"]).size).toBe(
      0,
    );
  });

  it("sends no rows when only spaces core trims changed", () => {
    const before = withRows(["/mnt/a"]);
    const spaced = updateRow(before, here.id, 1, { name: " ", path: "/mnt/a " }, APP_BACKUP_LIST);
    expect(isEmptyListChanges(listChanges(before, spaced, here.id, APP_BACKUP_LIST))).toBe(true);
  });

  it("calls a row unsaved when a save would write it: new, renamed, or moved to another folder", () => {
    const before = withRows(["/mnt/a", "/mnt/b"]);
    const saved = before[here.id];
    const unsaved = (groups: DeviceGroups<"data_folder">) =>
      groups[here.id].rows.filter((row) => rowUnsaved(saved, row)).map((row) => row.number);

    expect(unsaved(before)).toEqual([]);
    expect(unsaved(addRow(before, here, APP_BACKUP_LIST, "/mnt/c").groups)).toEqual([3]);
    expect(unsaved(updateRow(before, here.id, 1, { name: "USB" }, APP_BACKUP_LIST))).toEqual([1]);
    expect(unsaved(updateRow(before, here.id, 2, { path: "/mnt/d" }, APP_BACKUP_LIST))).toEqual([
      2,
    ]);
    // Spaces core trims, and a move, write nothing new for the row.
    expect(unsaved(updateRow(before, here.id, 1, { path: "/mnt/a " }, APP_BACKUP_LIST))).toEqual(
      [],
    );
    expect(unsaved(moveRow(before, here.id, 1, 1, APP_BACKUP_LIST))).toEqual([]);
  });
});
