import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  appendRow,
  deleteRow,
  deviceName,
  moveRow,
  otherGroups,
  removeGroup,
  rowLabel,
  rowProblems,
  rowUnsaved,
  selectionLabel,
  updateRow,
  type DeviceGroup,
  type DeviceGroups,
  type DeviceId,
  type FolderListPolicy,
  type HereDevice,
} from "@upriv/shared";
import { Button, Collapse, DisclosureChevron, MenuActionItem } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { ListBadge, ListOverline, RowConfirm, RowMenu, RowText } from "./parts";
import { problemKey } from "./problems";
import { RowEditor } from "./RowEditor";
import { shownPath } from "./shownPath";

/**
 * The other devices of a list, one collapsed card each, named by the device
 * and what it selects (desktop `OtherDevices` parity). Opened, a device
 * shows its rows, the one it selects marked, each with its ⋯ menu and text
 * edits checked against that device's own system. Nothing copies into a
 * phone, so no copy shows: the line under the heading says to pick the
 * folder here instead.
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
  const { colors, typography } = useTheme();
  const others = otherGroups(groups, here?.id ?? null);
  if (others.length === 0) return null;
  return (
    <View style={styles.section} accessibilityLabel={t("folder_list.other_devices")}>
      <View style={styles.sectionHead}>
        <ListOverline>{t("folder_list.other_devices")}</ListOverline>
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
          {t("folder_list.copy.phone_here")}
        </Text>
      </View>
      {others.map(([id, group]) => (
        <OtherDevice
          key={id}
          id={id}
          group={group}
          policy={policy}
          groups={groups}
          saved={saved}
          markUnsaved={markUnsaved}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function OtherDevice<F extends string>({
  id,
  group,
  policy,
  groups,
  saved,
  markUnsaved,
  onChange,
}: {
  id: DeviceId;
  group: DeviceGroup<F>;
  policy: FolderListPolicy<F>;
  groups: DeviceGroups<F>;
  saved: DeviceGroups<F>;
  markUnsaved: boolean;
  onChange: (groups: DeviceGroups<F>) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const name = deviceName(id, group.system, t);
  const summary = t("folder_list.selected_there", {
    choice: selectionLabel(group.selected, group, t),
  });
  const problems = rowProblems(saved[id], group, policy);
  const divider = { borderTopColor: colors.outlineVariant };

  return (
    <View
      // A row that holds the save marks its device, collapsed or not.
      style={[
        styles.device,
        {
          backgroundColor: colors.surfaceContainer,
          borderWidth: problems.size > 0 ? 2 : 1,
          borderColor: problems.size > 0 ? colors.vaultStatusRecovery : colors.outlineVariant,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={name}
        accessibilityHint={summary}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.deviceHeader, pressed ? styles.pressed : null]}
      >
        <DisclosureChevron open={open} size={16} color={colors.onSurfaceVariant} />
        <View style={styles.deviceTitle}>
          <Text
            style={[typography.body, styles.strong, { color: colors.onSurface }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text style={[typography.caption, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
            {summary}
          </Text>
        </View>
      </Pressable>
      <Collapse open={open}>
        <View style={[styles.deviceBody, divider]}>
          {group.rows.length > 0 ? (
            <View style={styles.rows}>
              {group.rows.map((row, index) => {
                const problem = problems.get(row.number) ?? null;
                const rowName = rowLabel(row, t);
                const shown = shownPath(row.path);
                return (
                  <View
                    key={row.number}
                    style={[
                      styles.row,
                      { backgroundColor: colors.surfaceContainerHigh },
                      problem ? { borderWidth: 2, borderColor: colors.vaultStatusRecovery } : null,
                    ]}
                  >
                    <View style={styles.top}>
                      <RowText
                        title={rowName}
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
                      >
                        {problem ? (
                          <Text
                            accessibilityRole="alert"
                            style={[typography.caption, { color: colors.onErrorContainer }]}
                          >
                            {t(problemKey(problem))}
                          </Text>
                        ) : null}
                      </RowText>
                      <RowMenu name={rowName}>
                        <MenuActionItem
                          icon="pencil"
                          label={t("folder_list.action.edit")}
                          selected={editing === row.number}
                          onPress={() => setEditing(editing === row.number ? null : row.number)}
                        />
                        <MenuActionItem
                          icon="arrow-up"
                          label={t("folder_list.action.move_up")}
                          disabled={index === 0}
                          onPress={() => onChange(moveRow(groups, id, row.number, -1, policy))}
                        />
                        <MenuActionItem
                          icon="arrow-down"
                          label={t("folder_list.action.move_down")}
                          disabled={index === group.rows.length - 1}
                          onPress={() => onChange(moveRow(groups, id, row.number, 1, policy))}
                        />
                        <MenuActionItem
                          icon="trash"
                          label={t("folder_list.action.delete")}
                          danger
                          onPress={() => {
                            if (editing === row.number) setEditing(null);
                            onChange(deleteRow(groups, id, row.number, policy));
                          }}
                        />
                      </RowMenu>
                    </View>
                    <Collapse open={editing === row.number}>
                      <RowEditor
                        name={row.name}
                        onName={(value) =>
                          onChange(updateRow(groups, id, row.number, { name: value }, policy))
                        }
                        folder={{
                          kind: "typed",
                          path: row.path,
                          onPath: (path) =>
                            onChange(updateRow(groups, id, row.number, { path }, policy)),
                        }}
                      />
                    </Collapse>
                  </View>
                );
              })}
            </View>
          ) : null}
          <View style={styles.footer}>
            <Button
              label={t("folder_list.action.remove_device_folders")}
              size="sm"
              variant="ghost"
              onPress={() => setRemoving(true)}
            />
            <Button
              label={t("folder_list.action.add")}
              size="sm"
              variant="secondary"
              icon="add"
              onPress={() => {
                const added = appendRow(groups, id, policy, "");
                onChange(added.groups);
                setEditing(added.number);
              }}
              style={styles.footerEnd}
            />
          </View>
          <Collapse open={removing}>
            <RowConfirm
              question={t("folder_list.remove_device_folders_confirm", { device: name })}
              confirmLabel={t("folder_list.action.remove_device_folders")}
              onConfirm={() => onChange(removeGroup(groups, id))}
              onCancel={() => setRemoving(false)}
            />
          </Collapse>
        </View>
      </Collapse>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.xs },
  sectionHead: { gap: 2 },
  device: { borderRadius: radii.md },
  deviceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.85 },
  deviceTitle: { flex: 1, minWidth: 0, gap: 2 },
  strong: { fontWeight: "500" },
  deviceBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  rows: { gap: spacing.sm, paddingBottom: spacing.sm },
  // A row card inside the device's card (desktop `p-2.5`).
  row: { borderRadius: radii.sm, padding: 10 },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  footerEnd: { marginLeft: "auto" },
});
