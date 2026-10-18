import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  plainFolderClassI18nKey,
  suggestedDefaultWorkspacePath,
  workspacePathDisplay,
  vaultRootPathForWorkspaceValidation,
  type PlainFolderClass,
  type PlainPlaceChoice,
} from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { PathField } from "@/components/PathField";
import { PolicyRadioOption } from "@/components/settings";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useVaultRootService } from "@/platform/services";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface PlainPlaceModalProps {
  open: boolean;
  vaultName: string;
  workspaceChoices: boolean;
  submitting: boolean;
  warningClass: PlainFolderClass | null;
  onClose: () => void;
  onContinue: (choice: PlainPlaceChoice, path: string) => void;
  onAcceptWarning: () => void;
}

export function PlainPlaceModal({
  open,
  vaultName,
  workspaceChoices,
  submitting,
  warningClass,
  onClose,
  onContinue,
  onAcceptWarning,
}: PlainPlaceModalProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const { settings } = useAppSettingsContext();
  const vaultRootService = useVaultRootService();
  const warningKey = warningClass ? plainFolderClassI18nKey(warningClass) : null;
  const [choice, setChoice] = useState<PlainPlaceChoice | null>(null);
  const [defaultPath, setDefaultPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setChoice(null);
    setDefaultPath("");
    setCustomPath("");
    setVaultPath("");
    setPickError(null);
  }, [open]);

  useEffect(() => {
    if (!open || workspaceChoices) return;
    setChoice("vault_only");
  }, [open, workspaceChoices]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await vaultRootService.resolve({
          vaultRootMode: settings.app.vault_root_mode,
        });
        if (cancelled) return;
        const root = resolved.status === "found" ? resolved.rootPath : null;
        setDefaultPath(
          suggestedDefaultWorkspacePath(
            vaultRootPathForWorkspaceValidation(
              settings.app.vault_root_mode,
              settings.app.upriv_root_path,
              root,
            ),
          ),
        );
      } catch {
        if (!cancelled) setDefaultPath("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, settings.app.upriv_root_path, settings.app.vault_root_mode, vaultRootService]);

  const canContinue =
    (workspaceChoices && choice === "default" && defaultPath.trim() !== "") ||
    (workspaceChoices && choice === "custom" && customPath.trim() !== "") ||
    (choice === "vault_only" && vaultPath.trim() !== "");

  const pickInto = (apply: (path: string) => void, current: string) => {
    void (async () => {
      setPickError(null);
      try {
        const picked = await vaultRootService.pickFolder(
          current.trim() || null,
          t("modal.app_settings.action.pick_workspace_folder"),
        );
        if (picked?.trim()) apply(picked.trim());
      } catch (error) {
        setPickError(t(mobileErrorI18nKey(error, "error.unexpected")));
      }
    })();
  };

  const selectFolderChoice = (
    next: "custom" | "vault_only",
    current: string,
    apply: (path: string) => void,
  ) => {
    setChoice(next);
    if (!current.trim()) pickInto(apply, current);
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
          {warningKey ? (
            <Button
              label={t("plain.confirm.action")}
              variant="primary"
              size="sm"
              disabled={submitting}
              onPress={onAcceptWarning}
            />
          ) : (
            <Button
              label={t("action.continue")}
              variant="primary"
              size="sm"
              disabled={submitting || !canContinue || !choice}
              onPress={() => {
                if (!choice || !canContinue) return;
                const path =
                  choice === "custom" ? customPath : choice === "vault_only" ? vaultPath : "";
                onContinue(choice, path.trim());
              }}
            />
          )}
        </ModalFooterActions>
      }
    >
      <View style={styles.stack}>
        <Text style={typography.bodyMuted}>{t("plain.place.body")}</Text>
        {warningKey ? (
          <Text style={typography.bodyMuted}>{t(warningKey)}</Text>
        ) : (
          <View style={styles.actions}>
            {!workspaceChoices ? (
              <Text style={typography.bodyMuted}>{t("plain.place.workspace_locked")}</Text>
            ) : null}
            <PolicyRadioOption
              value="default"
              checked={choice === "default"}
              title={t("plain.place.default")}
              description={t("plain.place.default_desc")}
              disabled={submitting || !workspaceChoices}
              onSelect={() => setChoice("default")}
              footer={
                choice === "default" ? (
                  <PathField value={workspacePathDisplay(defaultPath)} editable={false} />
                ) : undefined
              }
            />
            <PolicyRadioOption
              value="custom"
              checked={choice === "custom"}
              title={t("plain.place.custom")}
              description={t("plain.place.custom_desc")}
              disabled={submitting || !workspaceChoices}
              onSelect={() => selectFolderChoice("custom", customPath, setCustomPath)}
              footer={
                choice === "custom" ? (
                  <PlacePathEditor
                    value={customPath}
                    disabled={submitting}
                    onChange={setCustomPath}
                    onPick={() => pickInto(setCustomPath, customPath)}
                  />
                ) : undefined
              }
            />
            <PolicyRadioOption
              value="vault_only"
              checked={choice === "vault_only"}
              title={t("plain.place.vault_only")}
              description={t("plain.place.vault_only_desc")}
              disabled={submitting}
              onSelect={() => selectFolderChoice("vault_only", vaultPath, setVaultPath)}
              footer={
                choice === "vault_only" ? (
                  <PlacePathEditor
                    value={vaultPath}
                    disabled={submitting}
                    onChange={setVaultPath}
                    onPick={() => pickInto(setVaultPath, vaultPath)}
                  />
                ) : undefined
              }
            />
            {pickError ? (
              <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                {pickError}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

function PlacePathEditor({
  value,
  disabled,
  onChange,
  onPick,
}: {
  value: string;
  disabled: boolean;
  onChange: (path: string) => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.pathEditor}>
      <PathField
        value={value}
        disabled={disabled}
        placeholder={t("modal.app_settings.field.workspace.path_placeholder")}
        onChangeText={onChange}
      />
      <Button
        size="sm"
        variant="ghost"
        label={t("modal.app_settings.action.pick_workspace_folder")}
        disabled={disabled}
        onPress={onPick}
      />
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
