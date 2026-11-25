import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  besideFolder,
  plainPlaceProblem,
  type AppUnlockedChoice,
  type DeviceGroups,
  type PlainPlaceChoice,
  type RowProblem,
  type VaultUnlockedChoice,
} from "@upriv/shared";
import { hereDevice, useDataFolderPath, useDeviceInfo } from "@upriv/shared/react";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { PathField } from "@/components/PathField";
import { PolicyRadioOption } from "@/components/settings";
import { problemKey, shownPath } from "@/components/folder-list";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useDeviceService, useVaultRootService } from "@/platform/services";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface PlainPlaceModalProps {
  open: boolean;
  vaultName: string;
  /** The app's unlocked folders can change only while no vault is open. */
  appChoices: boolean;
  /** The app's unlocked folders, which a folder picked for the app's list may not repeat. */
  appUnlocked: DeviceGroups<AppUnlockedChoice>;
  /** The vault's own unlocked folders; `null` while they load. */
  vaultUnlocked: DeviceGroups<VaultUnlockedChoice> | null;
  submitting: boolean;
  onClose: () => void;
  onContinue: (choice: PlainPlaceChoice, path: string) => void;
}

/**
 * "Where should the files go?" before the password, when this phone has no
 * unlocked folder chosen for a plain-text vault: Beside the data folder, a
 * folder added to the app's list, or one added to this vault's own list.
 * Folders are picked, for their grants. A picked folder is checked at once
 * by the rules of the row it becomes (a folder already in that list, one
 * inside a `.upriv`); Continue waits until it passes, then saves it as that
 * list's choice on this phone. The unlock window that follows names the
 * folder, and warns when its drive is removable, network, or cloud.
 */
export function PlainPlaceModal({
  open,
  vaultName,
  appChoices,
  appUnlocked,
  vaultUnlocked,
  submitting,
  onClose,
  onContinue,
}: PlainPlaceModalProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const vaultRootService = useVaultRootService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const [choice, setChoice] = useState<PlainPlaceChoice | null>(null);
  const [appPath, setAppPath] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const dataFolder = useDataFolderPath(vaultRootService, open);
  const besidePath = here && dataFolder ? besideFolder(here.system, dataFolder) : null;

  useEffect(() => {
    if (open) return;
    setChoice(null);
    setAppPath("");
    setVaultPath("");
    setPickError(null);
  }, [open]);

  // The first option starts chosen. With the app's folders locked, only this
  // vault's own list is left.
  useEffect(() => {
    if (!open) return;
    setChoice((current) => (appChoices ? (current ?? "beside") : "vault_folder"));
  }, [open, appChoices]);

  /**
   * What the row a folder choice adds gets wrong; `undefined` while the
   * vault's list still loads. A phone's data folder is a tree address that no
   * picked folder repeats, so only the list's own rows count.
   */
  const ruleProblem = (
    folderChoice: "app_folder" | "vault_folder",
    path: string,
  ): RowProblem | null | undefined => {
    if (!path.trim()) return "empty";
    if (!here || (folderChoice === "vault_folder" && !vaultUnlocked)) return undefined;
    return plainPlaceProblem({
      choice: folderChoice,
      path,
      here,
      appUnlocked,
      vaultUnlocked: vaultUnlocked ?? {},
      dataFolder: null,
    });
  };
  const appRule = ruleProblem("app_folder", appPath);
  const vaultRule = ruleProblem("vault_folder", vaultPath);

  // A chosen option that still lacks its folder, or whose folder the list
  // refuses, carries the attention border and holds Continue; choosing it
  // opens nothing. Still loading holds Continue with no border.
  const refused = (rule: RowProblem | null | undefined) => rule !== null && rule !== undefined;
  const canContinue =
    (appChoices && choice === "beside") ||
    (appChoices && choice === "app_folder" && appRule === null) ||
    (choice === "vault_folder" && vaultRule === null);
  const ruleLine = (rule: RowProblem | null | undefined) =>
    rule && rule !== "empty" ? t(problemKey(rule)) : null;

  const pickInto = (apply: (path: string) => void) => {
    void (async () => {
      setPickError(null);
      try {
        const picked = await vaultRootService.pickFolder(
          null,
          t("modal.app_settings.action.choose_folder"),
        );
        if (picked?.trim()) apply(picked.trim());
      } catch (error) {
        setPickError(t(mobileErrorI18nKey(error, "error.unexpected")));
      }
    })();
  };

  return (
    <Modal
      open={open}
      title={t("plain.place.title")}
      titleIcon="folder"
      contextTitle={vaultName}
      onClose={() => {
        if (!submitting) onClose();
      }}
      dismissible={!submitting}
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={t("action.cancel")}
            variant="ghost"
            size="sm"
            disabled={submitting}
            onPress={onClose}
          />
          <Button
            label={t("action.continue")}
            variant="primary"
            size="sm"
            disabled={submitting || !canContinue || !choice}
            onPress={() => {
              if (!choice || !canContinue) return;
              const path =
                choice === "app_folder" ? appPath : choice === "vault_folder" ? vaultPath : "";
              onContinue(choice, path.trim());
            }}
          />
        </ModalFooterActions>
      }
    >
      <View style={styles.stack}>
        <Text style={typography.bodyMuted}>{t("plain.place.body")}</Text>
        <View style={styles.actions}>
          {!appChoices ? (
            <Text style={typography.bodyMuted}>{t("plain.place.app_locked")}</Text>
          ) : null}
          <PolicyRadioOption
            value="beside"
            checked={choice === "beside"}
            title={t("plain.place.beside")}
            badge="default"
            description={t("plain.place.beside_desc")}
            disabled={submitting || !appChoices}
            onSelect={() => setChoice("beside")}
            footer={
              <PathField
                value={besidePath ? shownPath(besidePath) : ""}
                openPath={besidePath}
                editable={false}
              />
            }
          />
          <PolicyRadioOption
            value="app_folder"
            checked={choice === "app_folder"}
            attention={refused(appRule)}
            title={t("plain.place.app_folder")}
            description={t("plain.place.app_folder_desc")}
            disabled={submitting || !appChoices}
            onSelect={() => setChoice("app_folder")}
            footer={
              <PlacePathPicker
                value={appPath}
                problem={ruleLine(appRule)}
                disabled={submitting}
                onPick={() => pickInto(setAppPath)}
              />
            }
          />
          <PolicyRadioOption
            value="vault_folder"
            checked={choice === "vault_folder"}
            attention={refused(vaultRule)}
            title={t("plain.place.vault_folder")}
            description={t("plain.place.vault_folder_desc")}
            disabled={submitting}
            onSelect={() => setChoice("vault_folder")}
            footer={
              <PlacePathPicker
                value={vaultPath}
                problem={ruleLine(vaultRule)}
                disabled={submitting}
                onPick={() => pickInto(setVaultPath)}
              />
            }
          />
          {pickError ? (
            <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
              {pickError}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** A picked folder, shown by its name: a phone folder is a grant, never a typed path. */
function PlacePathPicker({
  value,
  problem,
  disabled,
  onPick,
}: {
  value: string;
  /** Why the list refuses this folder, under it. */
  problem: string | null;
  disabled: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  return (
    <View style={styles.pathEditor}>
      <PathField
        value={shownPath(value)}
        editable={false}
        placeholder={t("vault.create.action.choose_folder")}
      />
      <Button
        size="sm"
        variant="ghost"
        label={t("modal.app_settings.action.choose_folder")}
        disabled={disabled}
        onPress={onPick}
      />
      {problem ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: colors.onErrorContainer }]}
        >
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

interface PlainHeldModalProps {
  open: boolean;
  count: number;
  submitting: boolean;
  onApply: () => void;
  onRestore: () => void;
}

export function PlainHeldModal({
  open,
  count,
  submitting,
  onApply,
  onRestore,
}: PlainHeldModalProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  return (
    <Modal
      open={open}
      title={t("plain.held.title")}
      titleIcon="folder"
      onClose={onRestore}
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={t("plain.held.restore")}
            variant="ghost"
            size="sm"
            disabled={submitting}
            onPress={onRestore}
          />
          <Button
            label={t("plain.held.apply")}
            variant="danger"
            size="sm"
            disabled={submitting}
            onPress={onApply}
          />
        </ModalFooterActions>
      }
    >
      <Text style={typography.bodyMuted}>{t("plain.held.body", { count: String(count) })}</Text>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  actions: { gap: spacing.sm },
  pathEditor: { gap: spacing.sm },
});
