/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBackupExportStep, type BackupExportFolder } from "@upriv/shared/react";

const KEY = "20260101000000-notes.zip";
const OTHER = "saves/20260102000000-notes.zip";
const LISTED = [KEY, OTHER];

/** A folder field. `answer` plays the picker saying `folder`. */
function fieldWith(path: string, picking = false) {
  let onPicked: ((folder: string) => void) | undefined;
  const chooseIfMissing = vi.fn((next?: (folder: string) => void) => {
    if (path.trim()) return false;
    onPicked = next;
    return true;
  });
  const folder: BackupExportFolder = {
    path,
    picking,
    chooseIfMissing,
    cancelPick: vi.fn(),
  };
  return { folder, chooseIfMissing, answer: (picked: string) => onPicked?.(picked) };
}

interface Props {
  folder: BackupExportFolder;
  open: boolean;
  listed: readonly string[];
  busy: boolean;
}

function setup(folder: BackupExportFolder, overrides: Partial<Props> = {}) {
  const onStart = vi.fn<(keys: readonly string[], destDir: string) => void>();
  const onBusy = vi.fn();
  const initialProps: Props = { folder, open: true, listed: LISTED, busy: false, ...overrides };
  const view = renderHook((props: Props) => useBackupExportStep({ ...props, onBusy, onStart }), {
    initialProps,
  });
  return { ...view, onStart, onBusy, initialProps };
}

describe("useBackupExportStep", () => {
  it("opens the picker while no folder is kept, and a picked folder starts the export", () => {
    const field = fieldWith("");
    const { result, onStart } = setup(field.folder);

    act(() => result.current.begin([KEY]));
    expect(result.current.keys).toEqual([KEY]);
    expect(field.chooseIfMissing).toHaveBeenCalledOnce();

    act(() => field.answer("/media/usb"));
    expect(onStart).toHaveBeenCalledWith([KEY], "/media/usb");
    expect(result.current.keys).toBeNull();
  });

  it("stays on the step when the pick is cancelled", () => {
    const field = fieldWith("");
    const { result, onStart } = setup(field.folder);

    act(() => result.current.begin([KEY]));
    expect(result.current.keys).toEqual([KEY]);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("waits for confirm with a kept folder, so the folder is seen first", () => {
    const field = fieldWith(" /media/My Copies ");
    const { result, onStart } = setup(field.folder);

    act(() => result.current.begin([KEY, OTHER]));
    expect(onStart).not.toHaveBeenCalled();
    expect(result.current.keys).toEqual([KEY, OTHER]);

    act(() => result.current.confirm());
    expect(onStart).toHaveBeenCalledWith([KEY, OTHER], "/media/My Copies");
    expect(result.current.keys).toBeNull();
  });

  it("starts from the field's own Choose folder", () => {
    const field = fieldWith("/media/usb");
    const { result, onStart } = setup(field.folder);

    act(() => result.current.begin([KEY]));
    act(() => result.current.picked("/media/other"));
    expect(onStart).toHaveBeenCalledWith([KEY], "/media/other");
  });

  it("does not confirm a folder that is missing, relative, or still being picked", () => {
    for (const folder of [
      fieldWith("").folder,
      fieldWith("relative/path").folder,
      fieldWith("/media/usb", true).folder,
    ]) {
      const { result, onStart } = setup(folder);
      act(() => result.current.begin([KEY]));
      act(() => result.current.confirm());
      expect(onStart).not.toHaveBeenCalled();
      expect(result.current.keys).toEqual([KEY]);
    }
  });

  it("reports a running export instead of opening a step", () => {
    const field = fieldWith("/media/usb");
    const { result, onBusy } = setup(field.folder, { busy: true });

    act(() => result.current.begin([KEY]));
    expect(onBusy).toHaveBeenCalledOnce();
    expect(result.current.keys).toBeNull();
    expect(field.chooseIfMissing).not.toHaveBeenCalled();
  });

  it("opens nothing without a backup", () => {
    const field = fieldWith("");
    const { result } = setup(field.folder);

    act(() => result.current.begin([]));
    expect(result.current.keys).toBeNull();
    expect(field.chooseIfMissing).not.toHaveBeenCalled();
  });

  it("cancel closes the step and lets go of an open pick", () => {
    const field = fieldWith("");
    const { result, onStart } = setup(field.folder);

    act(() => result.current.begin([KEY]));
    act(() => result.current.cancel());
    expect(result.current.keys).toBeNull();
    expect(field.folder.cancelPick).toHaveBeenCalled();
    act(() => result.current.confirm());
    expect(onStart).not.toHaveBeenCalled();
  });

  it("ends with the window", () => {
    const field = fieldWith("/media/usb");
    const { result, rerender, initialProps } = setup(field.folder);

    act(() => result.current.begin([KEY]));
    rerender({ ...initialProps, open: false });
    expect(result.current.keys).toBeNull();
    expect(field.folder.cancelPick).toHaveBeenCalled();
  });

  it("ends when one of its backups leaves the list, and stays for the others", () => {
    const field = fieldWith("/media/usb");
    const { result, rerender, initialProps } = setup(field.folder);

    act(() => result.current.begin([KEY]));
    rerender({ ...initialProps, listed: [KEY] });
    expect(result.current.keys).toEqual([KEY]);
    rerender({ ...initialProps, listed: [OTHER] });
    expect(result.current.keys).toBeNull();
  });
});
