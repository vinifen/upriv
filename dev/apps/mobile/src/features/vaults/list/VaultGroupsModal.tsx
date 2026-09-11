import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  displayNameErrorI18nKey,
  isRpcError,
  shouldBumpVaultRootEpoch,
  validateDisplayName,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import {
  Button,
  Modal,
  ModalFooterActions,
  modalFooterConfirmBtnStyle,
  Toast,
} from "@/components/ui";
import { FieldHint, FieldLabel, SwitchRow, ThemedInput } from "@/components/settings";
import { useTapNotPan } from "@/components/ui/ScrimDismiss";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useToast } from "@upriv/shared/react";
import { GroupedVaultPicker } from "@/features/vaults/list/GroupedVaultPicker";

const SAVED_INDICATOR_MS = 1500;

interface VaultGroupsModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
  groups: VaultGroup[];
  includeHidden?: boolean;
  onCreateGroup?: (
    displayName: string,
    groupedVaultIds: string[],
    hidden: boolean,
  ) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Create groups — opened from the list header ⋯ menu. */
export function VaultGroupsModal({
  open,
  onClose,
  vaults,
  groups,
  includeHidden = false,
  onCreateGroup,
  onDirtyChange,
}: VaultGroupsModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { message, show, dismiss } = useToast();
  const { settingsOnDisk, reportVaultRootIntegrityFailure } = useAppSettingsContext();

  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupedVaultIds, setGroupedVaultIds] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);
  const commitSaveLock = useRef(false);

  const pendingGroupName = newGroupName.trim();
  const isDirty = pendingGroupName.length > 0;

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setNewGroupName("");
    setGroupedVaultIds([]);
    setHidden(false);
    setGroupNameError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      setNewGroupName("");
      setGroupedVaultIds([]);
      setHidden(false);
      setGroupNameError(null);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (!isDirty) setSaveConfirmOpen(false);
  }, [isDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);
  const dismissConfirmOnBodyTap = useTapNotPan(
    dismissFooterConfirm,
    discardConfirmOpen || saveConfirmOpen,
  );

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  const hadOnDiskRef = useRef(false);
  useEffect(() => {
    if (settingsOnDisk) hadOnDiskRef.current = true;
  }, [settingsOnDisk]);

  useEffect(() => {
    if (!open || settingsOnDisk || !hadOnDiskRef.current) return;
    setSaveBusy(false);
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  }, [open, settingsOnDisk, onClose]);

  const requestClose = () => {
    if (discardConfirmOpen || saveConfirmOpen) {
      dismissFooterConfirm();
      return;
    }
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    handleClose();
  };

  const handleDiscardAndClose = () => {
    setNewGroupName("");
    setGroupedVaultIds([]);
    setHidden(false);
    setGroupNameError(null);
    handleClose();
  };

  const handleSaveClick = () => {
    if (!isDirty || saveBusy) return;
    const validation = validateDisplayName(pendingGroupName);
    if (validation) {
      setGroupNameError(
        t(
          displayNameErrorI18nKey(validation),
          validation === "too_long" ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) } : undefined,
        ),
      );
      return;
    }
    setGroupNameError(null);
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSave = () => {
    if (!isDirty || saveBusy) return;
    if (commitSaveLock.current) return;
    commitSaveLock.current = true;
    setSaveBusy(true);
    void (async () => {
      try {
        await onCreateGroup?.(pendingGroupName, groupedVaultIds, hidden);
        setNewGroupName("");
        setGroupedVaultIds([]);
        setHidden(false);
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      } catch (error) {
        setSaveConfirmOpen(false);
        if (shouldBumpVaultRootEpoch(error)) {
          void reportVaultRootIntegrityFailure(error).then(() => {
            handleClose();
          });
          return;
        }
        const fallback =
          isRpcError(error) && error.code === "invalid_request"
            ? APP_SETTINGS_ERROR_I18N_KEYS.INVALID_REQUEST
            : APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED;
        show(t(mobileErrorI18nKey(error, fallback)));
      } finally {
        commitSaveLock.current = false;
        setSaveBusy(false);
      }
    })();
  };

  const saveBlocked = !isDirty || saveBusy || saveConfirmOpen;

  if (!open) return null;

  const footer = (
    <View style={styles.footerCol}>
      <View>
        {discardConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
        ) : saveConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.groups.save_confirm")}</Text>
        ) : savedVisible ? (
          <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
            {t("modal.settings.saved")}
          </Text>
        ) : null}
      </View>
      {discardConfirmOpen ? (
        <ModalFooterActions layout="confirm">
          <Button
            variant="danger"
            label={t("modal.settings.discard_confirm_action")}
            style={modalFooterConfirmBtnStyle}
            onPress={handleDiscardAndClose}
          />
          <Button
            variant="ghost"
            label={t("modal.settings.discard_keep_editing")}
            style={modalFooterConfirmBtnStyle}
            onPress={dismissFooterConfirm}
          />
        </ModalFooterActions>
      ) : (
        <ModalFooterActions layout="confirm">
          <Button
            variant="primary"
            label={
              saveConfirmOpen ? t("modal.settings.save_confirm_action") : t("modal.settings.save")
            }
            style={modalFooterConfirmBtnStyle}
            disabled={saveConfirmOpen ? saveBusy : saveBlocked}
            onPress={saveConfirmOpen ? commitSave : handleSaveClick}
          />
          {saveConfirmOpen ? (
            <Button
              variant="ghost"
              label={t("modal.settings.save_cancel")}
              style={modalFooterConfirmBtnStyle}
              disabled={saveBusy}
              onPress={dismissFooterConfirm}
            />
          ) : null}
        </ModalFooterActions>
      )}
    </View>
  );

  return (
    <>
      <Modal
        open={open}
        title={t("app.menu.groups")}
        titleIcon="layers"
        onClose={requestClose}
        panelClassName="max-w-3xl"
        footer={footer}
      >
        <View style={styles.content} {...dismissConfirmOnBodyTap}>
          <View style={styles.fields}>
            <FieldHint>{t("modal.app_settings.section.groups_intro")}</FieldHint>
            <View style={styles.fieldGroup}>
              <FieldLabel>{t("modal.app_settings.field.new_group_name")}</FieldLabel>
              <FieldHint>{t("modal.app_settings.field.new_group_name_help")}</FieldHint>
              <ThemedInput
                value={newGroupName}
                maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
                onChangeText={(name) => {
                  setNewGroupName(name);
                  setGroupNameError(null);
                  setSaveConfirmOpen(false);
                  setDiscardConfirmOpen(false);
                }}
                placeholder={t("vault.group.create.name_label")}
              />
            </View>
            {groupNameError ? (
              <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                {groupNameError}
              </Text>
            ) : null}
            <SwitchRow
              label={t("vault.group.settings.hidden")}
              hint={t("vault.group.settings.hidden_help")}
              value={hidden}
              onValueChange={(next) => {
                setHidden(next);
                setSaveConfirmOpen(false);
                setDiscardConfirmOpen(false);
              }}
            />
            <View style={styles.fieldGroup}>
              <FieldLabel>{t("vault.group.create.grouped_vaults")}</FieldLabel>
              <FieldHint>{t("vault.group.create.grouped_vaults_help")}</FieldHint>
              <GroupedVaultPicker
                vaults={vaults}
                groups={groups}
                includeHidden={includeHidden}
                selectedIds={groupedVaultIds}
                onToggle={(vaultId) => {
                  setGroupedVaultIds((current) =>
                    current.includes(vaultId)
                      ? current.filter((id) => id !== vaultId)
                      : [...current, vaultId],
                  );
                  setSaveConfirmOpen(false);
                  setDiscardConfirmOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
      <Toast message={message} onDismiss={dismiss} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.sm },
  fields: { gap: spacing.md },
  fieldGroup: { gap: spacing.xs },
  footerCol: { gap: spacing.md },
});
