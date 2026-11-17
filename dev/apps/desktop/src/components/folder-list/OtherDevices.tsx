import { useId, useState } from "react";
import {
  appendRow,
  copyAll,
  copyRefusal,
  copyRow,
  deleteRow,
  deviceName,
  folderShownName,
  isPhoneSystem,
  moveRow,
  otherGroups,
  removeGroup,
  rowLabel,
  rowProblems,
  rowUnsaved,
  selectionLabel,
  updateRow,
  type CopyRefusal,
  type DeviceGroup,
  type DeviceGroups,
  type DeviceId,
  type FolderListPolicy,
  type FolderRow,
  type HereDevice,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { Button, Collapse, DisclosureChevron, type DropdownMenuItem } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { problemKey } from "./FolderList";
import { ListBadge, RowConfirm, RowMenu, RowText } from "./parts";
import { RowEditor } from "./RowEditor";

const REFUSAL_KEYS: Record<CopyRefusal, I18nKey> = {
  phone_here: "folder_list.copy.phone_here",
  phone_row: "folder_list.copy.phone_row",
  not_valid_here: "folder_list.copy.not_valid_here",
  already_here: "folder_list.copy.already_here",
};

/**
 * The other devices of a list, one collapsed card each, named by the device
 * and what it selects. Opened, a device shows its rows, the one it selects
 * marked, each with its ⋯ menu: Copy into this device, and text edits
 * checked against that device's own system. No radio, no status: only the
 * device in use chooses, and only it can check its folders. Nothing copies
 * into or out of a phone, so a phone's card offers no copy at all.
 */
export function OtherDevices<F extends string>({
  policy,
  groups,
  saved,
  here,
  markUnsaved = true,
  onChange,
}: {
  policy: FolderListPolicy<F>;
  groups: DeviceGroups<F>;
  saved: DeviceGroups<F>;
  here: HereDevice | null;
  /** A row a save would write carries Not saved. */
  markUnsaved?: boolean;
  onChange: (groups: DeviceGroups<F>) => void;
}) {
  const { t } = useTranslation();
  const others = otherGroups(groups, here?.id ?? null);
  if (others.length === 0) return null;
  return (
    <section className="space-y-2 pt-2" aria-label={t("folder_list.other_devices")}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        {t("folder_list.other_devices")}
      </h4>
      {others.map(([id, group]) => (
        <OtherDevice
          key={id}
          id={id}
          group={group}
          policy={policy}
          groups={groups}
          saved={saved}
          here={here}
          markUnsaved={markUnsaved}
          onChange={onChange}
        />
      ))}
    </section>
  );
}

function OtherDevice<F extends string>({
  id,
  group,
  policy,
  groups,
  saved,
  here,
  markUnsaved,
  onChange,
}: {
  id: DeviceId;
  group: DeviceGroup<F>;
  policy: FolderListPolicy<F>;
  groups: DeviceGroups<F>;
  saved: DeviceGroups<F>;
  here: HereDevice | null;
  markUnsaved: boolean;
  onChange: (groups: DeviceGroups<F>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const nameId = useId();
  const summaryId = useId();
  const bodyId = useId();
  const name = deviceName(id, group.system, t);
  const problems = rowProblems(saved[id], group, policy);
  // A phone's folder is a grant picked there: none copies into or out of a phone.
  const copies = here !== null && !isPhoneSystem(here.system) && !isPhoneSystem(group.system);
  const refusals = group.rows.map((row) =>
    here ? copyRefusal(groups, group, row, here, policy) : ("phone_here" as const),
  );
  // Copy all also takes a fixed choice that device selects.
  const canCopyAll =
    copies && (refusals.some((refusal) => refusal === null) || typeof group.selected !== "number");
  const copyAllWaits =
    copies && !canCopyAll
      ? refusals.find((refusal) => refusal !== null && refusal !== "already_here")
      : undefined;

  const rowItems = (row: FolderRow, index: number): DropdownMenuItem[] => {
    const refusal = refusals[index] ?? null;
    return [
      ...(copies && here
        ? [
            {
              id: "copy",
              label: t("folder_list.action.copy"),
              icon: <Icon name="copy" size={16} />,
              disabled: refusal !== null,
              description: refusal ? t(REFUSAL_KEYS[refusal]) : undefined,
              onSelect: () => onChange(copyRow(groups, id, row.number, here, policy)),
            },
          ]
        : []),
      {
        id: "edit",
        label: t("folder_list.action.edit"),
        icon: <Icon name="pencil" size={16} />,
        checked: editing === row.number,
        onSelect: () => setEditing(editing === row.number ? null : row.number),
      },
      {
        id: "up",
        label: t("folder_list.action.move_up"),
        icon: <Icon name="arrow-up" size={16} />,
        disabled: index === 0,
        onSelect: () => onChange(moveRow(groups, id, row.number, -1, policy)),
      },
      {
        id: "down",
        label: t("folder_list.action.move_down"),
        icon: <Icon name="arrow-down" size={16} />,
        disabled: index === group.rows.length - 1,
        onSelect: () => onChange(moveRow(groups, id, row.number, 1, policy)),
      },
      {
        id: "delete",
        label: t("folder_list.action.delete"),
        icon: <Icon name="trash" size={16} />,
        danger: true,
        onSelect: () => {
          if (editing === row.number) setEditing(null);
          onChange(deleteRow(groups, id, row.number, policy));
        },
      },
    ];
  };

  return (
    // A row that holds the save marks its device, collapsed or not.
    <div
      className={[
        "rounded-xl bg-surface-container transition-colors",
        open ? "" : "hover:bg-surface-container-high/80",
        problems.size > 0
          ? "border-2 border-[var(--vault-status-recovery)]"
          : "border border-outline-variant",
      ].join(" ")}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-labelledby={nameId}
        aria-describedby={summaryId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3.5"
      >
        <DisclosureChevron open={open} size={16} className="text-on-surface-variant" />
        <span className="min-w-0 flex-1">
          <span id={nameId} className="block truncate text-sm font-medium text-on-surface">
            {name}
          </span>
          <span id={summaryId} className="block truncate text-xs text-on-surface-variant">
            {t("folder_list.selected_there", {
              choice: selectionLabel(group.selected, group, t),
            })}
          </span>
        </span>
      </button>
      <Collapse open={open}>
        <div id={bodyId} className="border-t border-outline-variant px-3 pb-3 pt-3 sm:px-3.5">
          <ul className="space-y-1.5">
            {group.rows.map((row, index) => {
              const problem = problems.get(row.number) ?? null;
              const shown = folderShownName(row.path);
              return (
                <li
                  key={row.number}
                  className={[
                    "rounded-lg bg-surface-container-high p-2.5",
                    problem ? "border-2 border-[var(--vault-status-recovery)]" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <RowText
                      title={rowLabel(row, t)}
                      badges={
                        <>
                          {group.selected === row.number ? (
                            <ListBadge kind="selected_there" />
                          ) : null}
                          {markUnsaved && rowUnsaved(saved[id], row) ? (
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
                      ) : null}
                    </RowText>
                    <RowMenu name={rowLabel(row, t)} items={rowItems(row, index)} />
                  </div>
                  <Collapse open={editing === row.number}>
                    <RowEditor
                      name={row.name}
                      path={row.path}
                      onName={(rowName) =>
                        onChange(updateRow(groups, id, row.number, { name: rowName }, policy))
                      }
                      onPath={(path) =>
                        onChange(updateRow(groups, id, row.number, { path }, policy))
                      }
                    />
                  </Collapse>
                </li>
              );
            })}
          </ul>
          {isPhoneSystem(group.system) ? (
            <p className="pt-2.5 text-xs leading-relaxed text-on-surface-variant">
              {t("folder_list.copy.phone_row")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              {t("folder_list.action.remove_device_folders")}
            </Button>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {copies && here ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5"
                  disabled={!canCopyAll}
                  onClick={() => onChange(copyAll(groups, id, here, policy))}
                >
                  <Icon name="copy" size={16} />
                  {t("folder_list.action.copy_all")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={() => {
                  const added = appendRow(groups, id, policy, "");
                  onChange(added.groups);
                  setEditing(added.number);
                }}
              >
                <Icon name="add" size={16} />
                {t("folder_list.action.add")}
              </Button>
            </div>
          </div>
          {copyAllWaits ? (
            <p className="pt-2 text-xs leading-relaxed text-on-surface-variant">
              {t(REFUSAL_KEYS[copyAllWaits])}
            </p>
          ) : null}
          <Collapse open={removing}>
            <RowConfirm
              question={t("folder_list.remove_device_folders_confirm", { device: name })}
              confirmLabel={t("folder_list.action.remove_device_folders")}
              onConfirm={() => onChange(removeGroup(groups, id))}
              onCancel={() => setRemoving(false)}
            />
          </Collapse>
        </div>
      </Collapse>
    </div>
  );
}
