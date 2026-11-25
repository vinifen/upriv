import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  addRow,
  deleteRow,
  deviceName,
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
import { useOsNames } from "@upriv/shared/react";
import { useRevealFolder } from "@/components/RevealPathButton";
import { Button, Collapse, MenuActionItem } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { OtherDevices } from "./OtherDevices";
import {
  DeviceHeading,
  ListBadge,
  RadioMark,
  ROW_INSET,
  RowConfirm,
  RowMenu,
  RowText,
  rowCardStyle,
} from "./parts";
import { problemKey } from "./problems";
import { RowEditor } from "./RowEditor";
import { shownPath } from "./shownPath";

/** A choice a list always has, above its rows. */
export interface FixedChoiceOption<F extends string> {
  choice: F;
  title: string;
  description?: string;
  /** The folder it names, shown read-only as the Files app names it (desktop parity). */
  folder?: string | null;
  /** Its own status line. */
  status?: ReactNode;
}

export interface FolderListProps<F extends string> {
  /** Names the radio group for a screen reader. */
  label: string;
  policy: FolderListPolicy<F>;
  groups: DeviceGroups<F>;
  /** As loaded: a row loaded as it is keeps its path unchecked. */
  saved: DeviceGroups<F>;
  /** The current device; `null` while it has no ID, and its folders cannot change. */
  here: HereDevice | null;
  fixed: readonly FixedChoiceOption<F>[];
  /** Why this device's group cannot change now; `null` when it can. */
  lockedHint?: string | null;
  /** Nothing can change while the window's own work runs. */
  disabled?: boolean;
  /** Another option of the window is chosen: no choice of the list shows chosen. */
  noneChecked?: boolean;
  renderStatus?: (path: string) => ReactNode;
  /** The selected choice misses a step the caller checks. */
  selectionAttention?: boolean;
  /**
   * The step the selected choice still needs, inside its card under its
   * status (a Retry, a data folder's replace choice), so the card that wears
   * attention holds what clears it.
   */
  selectedFooter?: ReactNode;
  /** The choice in use now: it wears a badge. */
  inUse?: Selection<F> | null;
  /** A row whose delete asks first, and the question. */
  confirmDelete?: (row: FolderRow) => string | null;
  /**
   * An open vault uses the row's folder: core keeps the row until that vault
   * closes, so its delete and its folder wait; its name can still change.
   */
  rowInUse?: (row: FolderRow) => boolean;
  /**
   * A row a save would write carries Not saved. Off where nothing is saved
   * yet (a vault being created).
   */
  markUnsaved?: boolean;
  /** Pick a folder on this phone: a storage-access grant, or `null` when cancelled. */
  pickFolder: () => Promise<string | null>;
  /** A picked folder that is a fixed choice's own folder selects that choice. */
  pickedChoice?: (picked: string) => F | null;
  onChange: (groups: DeviceGroups<F>) => void;
}

/**
 * The phone's group of one list (desktop `FolderList` parity): the list's
 * fixed choices on top, the rows below them in their priority order, and Add
 * folder on the right at the bottom, so a picked folder lands right above
 * it. A failing folder hands over down the rows, then to the fixed choices.
 * A tap on a row selects it; its ⋯ menu sits outside that part and only acts
 * on the row, whose editor and delete question open under it. This phone's
 * folders are picked, never typed. With another device in the list, this
 * device's group shows under This device with its name, and the other
 * devices below it.
 */
export function FolderList<F extends string>({
  label,
  policy,
  groups,
  saved,
  here,
  fixed,
  lockedHint = null,
  disabled = false,
  noneChecked = false,
  renderStatus,
  selectionAttention = false,
  selectedFooter = null,
  inUse = null,
  confirmDelete,
  rowInUse,
  markUnsaved = true,
  pickFolder,
  pickedChoice,
  onChange,
}: FolderListProps<F>) {
  const { t } = useTranslation();
  const osNames = useOsNames();
  const { colors, typography } = useTheme();
  const reveal = useRevealFolder();
  const [pickError, setPickError] = useState<unknown>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const hereId = here?.id ?? null;
  const group = hereId ? groups[hereId] : undefined;
  const savedHere = hereId ? saved[hereId] : undefined;
  const rows = group?.rows ?? [];
  const selected = noneChecked ? null : (group?.selected ?? policy.fallback);
  const locked = disabled || !here || lockedHint !== null;
  const problems = group ? rowProblems(savedHere, group, policy) : new Map<number, RowProblem>();
  const showDevices = hasOtherDevices(groups, hereId);

  const select = (selection: Selection<F>) => {
    if (!here || locked) return;
    onChange(selectHere(groups, here, policy, selection));
  };

  const pick = (apply: (picked: string) => void) => {
    setPickError(null);
    void pickFolder()
      .then((picked) => {
        if (picked?.trim()) apply(picked.trim());
      })
      .catch((error: unknown) => setPickError(error));
  };

  /** A picked folder becomes a new selected row, or selects the fixed choice it is. */
  const add = () => {
    if (!here || locked) return;
    pick((picked) => {
      const choice = pickedChoice?.(picked) ?? null;
      if (choice) {
        onChange(selectHere(groups, here, policy, choice));
        return;
      }
      onChange(addRow(groups, here, policy, picked).groups);
    });
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

  return (
    <View style={styles.list}>
      {!here ? (
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
          {t("folder_list.device_unknown")}
        </Text>
      ) : null}
      {lockedHint ? (
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>{lockedHint}</Text>
      ) : null}
      {showDevices && here ? (
        <DeviceHeading
          heading={t("folder_list.this_device")}
          name={deviceName(here.id, here.system, osNames, t)}
        />
      ) : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
        {fixed.map((option) => {
          const checked = selected === option.choice;
          return (
            <View
              key={option.choice}
              style={rowCardStyle(colors, checked, checked && selectionAttention, locked)}
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: locked }}
                accessibilityLabel={option.title}
                disabled={locked}
                onPress={() => select(option.choice)}
                style={styles.fixedChoice}
              >
                <RadioMark checked={checked} />
                <RowText
                  title={option.title}
                  badges={
                    <>
                      {inUse === option.choice ? <ListBadge kind="in_use" /> : null}
                      {policy.fallback === option.choice ? <ListBadge kind="default" /> : null}
                    </>
                  }
                  description={option.description}
                  folder={option.folder}
                >
                  {option.status}
                </RowText>
              </Pressable>
              {checked && selectedFooter ? (
                <View style={[styles.inset, styles.selectedFooter]}>{selectedFooter}</View>
              ) : null}
            </View>
          );
        })}
        {rows.map((row, index) => {
          const checked = selected === row.number;
          const problem = problems.get(row.number) ?? null;
          const held = rowInUse?.(row) ?? false;
          const question = confirmDelete?.(row) ?? null;
          const location = reveal.locate(row.path);
          const name = rowLabel(row, t);
          const shown = shownPath(row.path);
          return (
            <View
              key={row.number}
              style={rowCardStyle(
                colors,
                checked,
                problem !== null || (checked && selectionAttention),
                locked,
              )}
            >
              <View style={styles.top}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked, disabled: locked }}
                  accessibilityLabel={name}
                  disabled={locked}
                  onPress={() => select(row.number)}
                  style={styles.choice}
                >
                  <RadioMark checked={checked} />
                  <RowText
                    title={name}
                    badges={
                      <>
                        {inUse === row.number ? <ListBadge kind="in_use" /> : null}
                        {markUnsaved && rowUnsaved(savedHere, row) ? (
                          <ListBadge kind="unsaved" />
                        ) : null}
                      </>
                    }
                    folder={shown || t("folder_list.row.no_path")}
                  >
                    {problem ? (
                      <Text
                        accessibilityRole="alert"
                        style={[typography.caption, { color: colors.onErrorContainer }]}
                      >
                        {t(problemKey(problem))}
                      </Text>
                    ) : shown ? (
                      renderStatus?.(row.path)
                    ) : null}
                  </RowText>
                </Pressable>
                <RowMenu name={name}>
                  <MenuActionItem
                    icon="pencil"
                    label={t("folder_list.action.edit")}
                    disabled={locked}
                    selected={editing === row.number}
                    onPress={() => setEditing(editing === row.number ? null : row.number)}
                  />
                  {location ? (
                    <MenuActionItem
                      icon="file-manager"
                      label={t("action.open_folder")}
                      onPress={() => reveal.open(location)}
                    />
                  ) : null}
                  <MenuActionItem
                    icon="arrow-up"
                    label={t("folder_list.action.move_up")}
                    disabled={locked || index === 0}
                    onPress={() => move(row, -1)}
                  />
                  <MenuActionItem
                    icon="arrow-down"
                    label={t("folder_list.action.move_down")}
                    disabled={locked || index === rows.length - 1}
                    onPress={() => move(row, 1)}
                  />
                  <MenuActionItem
                    icon="trash"
                    label={t("folder_list.action.delete")}
                    description={held ? t("folder_list.row.in_use") : undefined}
                    danger
                    disabled={locked || held}
                    onPress={() => (question ? setAsking(row.number) : remove(row))}
                  />
                </RowMenu>
              </View>
              {checked && selectedFooter && !problem ? (
                <View style={[styles.inset, styles.selectedFooter]}>{selectedFooter}</View>
              ) : null}
              <Collapse open={asking === row.number}>
                <View style={styles.inset}>
                  <RowConfirm
                    question={question ?? ""}
                    confirmLabel={t("folder_list.action.delete")}
                    onConfirm={() => remove(row)}
                    onCancel={() => setAsking(null)}
                  />
                </View>
              </Collapse>
              {hereId ? (
                <Collapse open={editing === row.number}>
                  <View style={styles.inset}>
                    <RowEditor
                      name={row.name}
                      onName={(rowName) =>
                        onChange(updateRow(groups, hereId, row.number, { name: rowName }, policy))
                      }
                      folder={{
                        kind: "picked",
                        path: row.path,
                        held: held ? t("folder_list.row.in_use") : null,
                        onPick: () =>
                          pick((picked) =>
                            onChange(
                              updateRow(groups, hereId, row.number, { path: picked }, policy),
                            ),
                          ),
                      }}
                    />
                  </View>
                </Collapse>
              ) : null}
            </View>
          );
        })}
      </View>
      <Button
        label={t("folder_list.action.add")}
        size="sm"
        variant="secondary"
        icon="add"
        disabled={locked}
        onPress={add}
        style={styles.add}
      />
      {pickError ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: colors.onErrorContainer }]}
        >
          {t(mobileErrorI18nKey(pickError, "error.unexpected"))}
        </Text>
      ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  choices: { gap: spacing.sm },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  choice: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  // In the card's column: as tall as its text, the footer under it.
  fixedChoice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  inset: { paddingLeft: ROW_INSET },
  selectedFooter: { paddingTop: spacing.md, gap: spacing.sm },
  add: { alignSelf: "flex-end" },
});
