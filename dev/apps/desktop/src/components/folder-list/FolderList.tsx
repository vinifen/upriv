import { useId, useState, type ReactNode } from "react";
import {
  NOTHING_SELECTED,
  addRow,
  deleteRow,
  deviceName,
  folderShownName,
  hasOtherDevices,
  moveRow,
  rowLabel,
  rowProblems,
  rowUnsaved,
  selectHere,
  updateRow,
  type DeviceGroups,
  type FolderListPolicy,
  type FolderRow,
  type HereDevice,
  type RowProblem,
  type Selection,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useRevealFolder } from "@/components/RevealPathButton";
import { Button, Collapse, type DropdownMenuItem } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import {
  DeviceHeading,
  ListBadge,
  ROW_INSET_CLASS,
  RowConfirm,
  RowMenu,
  RowText,
  rowCardClass,
} from "./parts";
import { OtherDevices } from "./OtherDevices";
import { RowEditor } from "./RowEditor";

/** A choice a list always has, above its rows. */
export interface FixedChoiceOption<F extends string> {
  choice: F;
  title: string;
  description?: string;
  /** The folder it names, shown read-only (Default's folder, the data folder). */
  folder?: string | null;
  /** Its own status line. */
  status?: ReactNode;
}

export interface FolderListProps<F extends string> {
  /** Names the radio group for a screen reader. */
  label: string;
  policy: FolderListPolicy<F>;
  /** The draft. */
  groups: DeviceGroups<F>;
  /** As loaded: a row loaded as it is keeps its path unchecked. */
  saved: DeviceGroups<F>;
  /** The current device; `null` while it has no ID, and its folders cannot change. */
  here: HereDevice | null;
  fixed: readonly FixedChoiceOption<F>[];
  /** Folders of this device's fixed choices, which no row may repeat. */
  fixedFolders?: readonly string[];
  /** Why this device's group cannot change now; `null` when it can. */
  lockedHint?: string | null;
  /** Nothing can change while the window's own work runs, with no hint of its own. */
  disabled?: boolean;
  /** Another option of the window is chosen: no radio of the list shows checked. */
  noneChecked?: boolean;
  /** A row's status line, by its path. */
  renderStatus?: (path: string) => ReactNode;
  /** The selected choice misses a step the caller checks (a data folder that does not answer). */
  selectionAttention?: boolean;
  /**
   * The window needs a folder from this list on this device, and the
   * selection gives none: the selected choice, or every choice while nothing
   * is selected, wears attention, and this line says why.
   */
  selectionMissing?: string | null;
  /** The choice in use now: it wears a badge. */
  inUse?: Selection<F> | null;
  /** A row whose delete asks first, and the question. */
  confirmDelete?: (row: FolderRow) => string | null;
  /**
   * An open vault uses the row's folder: core keeps the row until that vault
   * closes, so its delete and its path wait; its name can still change.
   */
  rowInUse?: (row: FolderRow) => boolean;
  /**
   * A row a save would write carries Not saved. Off where nothing is saved
   * yet (a vault being created).
   */
  markUnsaved?: boolean;
  /** Where the folder picker starts. */
  pickStart?: string | null;
  pickFolder: (start: string | null) => Promise<string | null>;
  onChange: (groups: DeviceGroups<F>) => void;
}

const PROBLEM_KEYS: Record<RowProblem, I18nKey> = {
  empty: "folder_list.problem.empty",
  not_absolute: "folder_list.problem.not_absolute",
  reserved: "folder_list.problem.reserved",
  overlap: "folder_list.problem.overlap",
  duplicate: "folder_list.problem.duplicate",
};

export function problemKey(problem: RowProblem): I18nKey {
  return PROBLEM_KEYS[problem];
}

/**
 * The current device's group of one list: one radio group, the list's fixed
 * choices on top, the rows below them in their priority order, and Add
 * folder on the right at the bottom, so a new row opens right above it. A
 * failing folder hands over down the rows, then to the fixed choices. Each
 * row's radio part selects; its ⋯ menu sits outside the radio and only acts
 * on the row, whose editor and delete question open under it. With another
 * device in the list, this device's group shows under This device with its
 * name, and the other devices below it.
 */
export function FolderList<F extends string>({
  label,
  policy,
  groups,
  saved,
  here,
  fixed,
  fixedFolders = [],
  lockedHint = null,
  disabled = false,
  noneChecked = false,
  renderStatus,
  selectionAttention = false,
  selectionMissing = null,
  inUse = null,
  confirmDelete,
  rowInUse,
  markUnsaved = true,
  pickStart = null,
  pickFolder,
  onChange,
}: FolderListProps<F>) {
  const { t } = useTranslation();
  const radioName = useId();
  const reveal = useRevealFolder();
  const [editing, setEditing] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const hereId = here?.id ?? null;
  const group = hereId ? groups[hereId] : undefined;
  const savedHere = hereId ? saved[hereId] : undefined;
  const rows = group?.rows ?? [];
  const selected = noneChecked ? null : (group?.selected ?? policy.fallback);
  const locked = disabled || !here || lockedHint !== null;
  const problems = group
    ? rowProblems(savedHere, group, policy, fixedFolders)
    : new Map<number, RowProblem>();
  const showDevices = hasOtherDevices(groups, hereId);
  const missing = selectionMissing !== null;
  const cursor = locked ? "cursor-not-allowed" : "cursor-pointer";
  /**
   * A card's border: a row's own problem, which holds the save whether it is
   * selected or not, or the choice the window still needs.
   */
  const attention = (checked: boolean, problem: boolean) =>
    problem ||
    (checked && (selectionAttention || missing)) ||
    (missing && selected === NOTHING_SELECTED);

  const select = (selection: Selection<F>) => {
    if (!here || locked) return;
    onChange(selectHere(groups, here, policy, selection));
  };

  /** A new row joins the bottom, last in priority, selected and open on its path. */
  const add = () => {
    if (!here || locked) return;
    const added = addRow(groups, here, policy, "");
    onChange(added.groups);
    setEditing(added.number);
  };

  const remove = (row: FolderRow) => {
    if (!hereId) return;
    setAsking(null);
    if (editing === row.number) setEditing(null);
    onChange(deleteRow(groups, hereId, row.number, policy));
  };

  const move = (row: FolderRow, by: -1 | 1) => {
    if (hereId) onChange(moveRow(groups, hereId, row.number, by, policy));
  };

  const rowItems = (row: FolderRow, index: number): DropdownMenuItem[] => {
    const held = rowInUse?.(row) ?? false;
    const location = reveal.locate(row.path);
    const question = confirmDelete?.(row) ?? null;
    return [
      {
        id: "edit",
        label: t("folder_list.action.edit"),
        icon: <Icon name="pencil" size={16} />,
        disabled: locked,
        checked: editing === row.number,
        onSelect: () => setEditing(editing === row.number ? null : row.number),
      },
      ...(location
        ? [
            {
              id: "open",
              label: t("action.open_folder"),
              icon: <Icon name="file-manager" size={16} />,
              onSelect: () => void reveal.open(location),
            },
          ]
        : []),
      {
        id: "up",
        label: t("folder_list.action.move_up"),
        icon: <Icon name="arrow-up" size={16} />,
        disabled: locked || index === 0,
        onSelect: () => move(row, -1),
      },
      {
        id: "down",
        label: t("folder_list.action.move_down"),
        icon: <Icon name="arrow-down" size={16} />,
        disabled: locked || index === rows.length - 1,
        onSelect: () => move(row, 1),
      },
      {
        id: "delete",
        label: t("folder_list.action.delete"),
        icon: <Icon name="trash" size={16} />,
        danger: true,
        disabled: locked || held,
        description: held ? t("folder_list.row.in_use") : undefined,
        onSelect: () => (question ? setAsking(row.number) : remove(row)),
      },
    ];
  };

  return (
    <div className="space-y-2.5">
      {!here ? (
        <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
          {t("folder_list.device_unknown")}
        </p>
      ) : null}
      {lockedHint ? (
        <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
          {lockedHint}
        </p>
      ) : null}
      {showDevices && here ? (
        <DeviceHeading
          heading={t("folder_list.this_device")}
          name={deviceName(here.id, here.system, t)}
        />
      ) : null}
      <div role="radiogroup" aria-label={label} className="grid gap-2">
        {fixed.map((option) => {
          const checked = selected === option.choice;
          return (
            <label
              key={option.choice}
              className={[
                rowCardClass(checked, attention(checked, false)),
                "flex gap-2.5 sm:gap-3",
                cursor,
              ].join(" ")}
            >
              <input
                type="radio"
                name={radioName}
                checked={checked}
                disabled={locked}
                onChange={() => select(option.choice)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <RowText
                title={option.title}
                badges={inUse === option.choice ? <ListBadge kind="in_use" /> : null}
                description={option.description}
                folder={option.folder}
              >
                {option.status}
              </RowText>
            </label>
          );
        })}
        {rows.map((row, index) => {
          const checked = selected === row.number;
          const problem = problems.get(row.number) ?? null;
          const shown = folderShownName(row.path);
          return (
            <div
              key={row.number}
              className={rowCardClass(checked, attention(checked, problem !== null))}
            >
              <div className="flex items-center gap-2">
                <label className={["flex min-w-0 flex-1 gap-2.5 sm:gap-3", cursor].join(" ")}>
                  <input
                    type="radio"
                    name={radioName}
                    checked={checked}
                    disabled={locked}
                    onChange={() => select(row.number)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <RowText
                    title={rowLabel(row, t)}
                    badges={
                      <>
                        {inUse === row.number ? <ListBadge kind="in_use" /> : null}
                        {markUnsaved && rowUnsaved(savedHere, row) ? (
                          <ListBadge kind="unsaved" />
                        ) : null}
                      </>
                    }
                    folder={shown || t("folder_list.row.no_path")}
                    fullFolder={row.path.trim()}
                  >
                    {problem ? (
                      <span className="mt-1 block text-xs text-on-error-container" role="alert">
                        {t(problemKey(problem))}
                      </span>
                    ) : shown ? (
                      renderStatus?.(row.path)
                    ) : null}
                  </RowText>
                </label>
                <RowMenu name={rowLabel(row, t)} items={rowItems(row, index)} />
              </div>
              <Collapse open={asking === row.number}>
                <div className={ROW_INSET_CLASS}>
                  <RowConfirm
                    question={confirmDelete?.(row) ?? ""}
                    confirmLabel={t("folder_list.action.delete")}
                    onConfirm={() => remove(row)}
                    onCancel={() => setAsking(null)}
                  />
                </div>
              </Collapse>
              {hereId ? (
                <Collapse open={editing === row.number}>
                  <div className={ROW_INSET_CLASS}>
                    <RowEditor
                      name={row.name}
                      path={row.path}
                      pickStart={row.path.trim() || pickStart}
                      pickFolder={pickFolder}
                      pathHeld={rowInUse?.(row) ? t("folder_list.row.in_use") : null}
                      onName={(name) =>
                        onChange(updateRow(groups, hereId, row.number, { name }, policy))
                      }
                      onPath={(path) =>
                        onChange(updateRow(groups, hereId, row.number, { path }, policy))
                      }
                    />
                  </div>
                </Collapse>
              ) : null}
            </div>
          );
        })}
      </div>
      {selectionMissing ? (
        <p className="text-xs leading-relaxed text-on-error-container" role="status">
          {selectionMissing}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" className="gap-1.5" disabled={locked} onClick={add}>
          <Icon name="add" size={16} />
          {t("folder_list.action.add")}
        </Button>
      </div>
      {showDevices ? (
        <OtherDevices
          policy={policy}
          groups={groups}
          saved={saved}
          here={here}
          markUnsaved={markUnsaved}
          onChange={onChange}
        />
      ) : null}
      {reveal.toast}
    </div>
  );
}
