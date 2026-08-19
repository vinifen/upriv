import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  LOADING_BUDGET_MS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  displayNameErrorI18nKey,
  displayNameToGroupId,
  normalizeVaultSettingsConfig,
  patchCloseDefaultAction,
  patchStorageMode,
  storageModeCanSeal,
  validateDisplayName,
  vaultSettingsEqual,
  vaultSettingsToListPatch,
  type CloseDefaultAction,
  type CreateVaultGroupAssignment,
  type StorageMode,
  type VaultGroup,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useVaultService } from "@/platform/services";
import { getMockVaultSettings } from "@/platform/mocks/stores/vaultSettings";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { VaultSettingsForm } from "./vaultSettingsForm";

function cloneSettings(config: VaultSettingsConfig): VaultSettingsConfig {
  return JSON.parse(JSON.stringify(config)) as VaultSettingsConfig;
}

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: (vaultId: string, patch: ReturnType<typeof vaultSettingsToListPatch>) => void;
  showToast: (message: string) => void;
  groups?: VaultGroup[];
  onCommitGroupAssignment?: (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => Promise<void> | void;
}

const SAVED_INDICATOR_MS = 1500;

export function VaultSettingsModal({
  vault,
  open,
  onClose,
  onSaved,
  showToast,
  groups = [],
  onCommitGroupAssignment,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const vaultId = vault?.id ?? null;

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [baseline, setBaseline] = useState<VaultSettingsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState<string | null>(null);

  const loadGen = useRef(0);
  const encryptedClosePreferenceRef = useRef<CloseDefaultAction>("close");
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const loading = Boolean(open && vaultId && !draft && !loadError && !loadTimedOut);
  const loadBudget = useLoadingBudget(loading, LOADING_BUDGET_MS.settingsLoad);

  const baselineGroupId = useMemo(
    () =>
      vaultId
        ? (groups.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "")
        : "",
    [groups, vaultId],
  );

  const pendingGroupName = newGroupName.trim();
  const groupDirty =
    Boolean(draft) &&
    (pendingGroupName.length > 0 || selectedGroupId !== baselineGroupId);

  const isDirty = useMemo(
    () =>
      Boolean(draft && baseline && !vaultSettingsEqual(draft, baseline)) || groupDirty,
    [draft, baseline, groupDirty],
  );

  const reload = useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open || !vaultId) {
      loadGen.current += 1;
      setDraft(null);
      setBaseline(null);
      setLoadError(null);
      setSaveError(null);
      setLoadTimedOut(false);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setSelectedGroupId("");
      setNewGroupName("");
      setGroupNameError(null);
      return;
    }

    let cancelled = false;
    const gen = ++loadGen.current;
    setDraft(null);
    setBaseline(null);
    setLoadError(null);
    setSaveError(null);
    setLoadTimedOut(false);

    const apply = (settings: VaultSettingsConfig) => {
      const normalized = cloneSettings(normalizeVaultSettingsConfig(settings));
      setBaseline(normalized);
      setDraft(cloneSettings(normalized));
      setSelectedGroupId(
        groupsRef.current.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "",
      );
      setNewGroupName("");
      setGroupNameError(null);
      if (storageModeCanSeal(normalized.storage.mode)) {
        encryptedClosePreferenceRef.current = normalized.close.default_action;
      }
    };

    void vaultService
      .getSettings(vaultId)
      .then((settings) => {
        if (cancelled || gen !== loadGen.current) return;
        apply(settings ?? getMockVaultSettings(vaultId));
      })
      .catch((caught) => {
        if (cancelled || gen !== loadGen.current) return;
        try {
          apply(getMockVaultSettings(vaultId));
        } catch {
          setLoadError(t(mobileErrorI18nKey(caught)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, vaultId, vaultService, loadAttempt, t]);

  useEffect(() => {
    if (!loadBudget.timedOut) return;
    loadGen.current += 1;
    setLoadTimedOut(true);
  }, [loadBudget.timedOut]);

  useEffect(() => {
    if (!isDirty) setSaveConfirmOpen(false);
  }, [isDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof VaultSettingsConfig>(section: S, patch: Partial<VaultSettingsConfig[S]>) => {
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setSaveError(null);
      setDraft((current) => {
        if (!current) return current;

        if (section === "storage" && "mode" in patch && typeof patch.mode === "string") {
          if (vault?.session === "open") return current;
          const { config: next, encryptedClosePreference } = patchStorageMode(
            current,
            patch.mode as StorageMode,
            encryptedClosePreferenceRef.current,
          );
          encryptedClosePreferenceRef.current = encryptedClosePreference;
          return next;
        }

        if (
          section === "close" &&
          "default_action" in patch &&
          typeof patch.default_action === "string"
        ) {
          const { config: next, encryptedClosePreference } = patchCloseDefaultAction(
            current,
            patch.default_action as CloseDefaultAction,
            encryptedClosePreferenceRef.current,
          );
          encryptedClosePreferenceRef.current = encryptedClosePreference;
          return next;
        }

        return {
          ...current,
          [section]: { ...current[section], ...patch },
        };
      });
    },
    [vault?.session],
  );

  const handleClose = useCallback(() => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  }, [onClose]);

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
    if (baseline) setDraft(baseline);
    setSelectedGroupId(baselineGroupId);
    setNewGroupName("");
    setGroupNameError(null);
    handleClose();
  };

  const persistDraft = useCallback(async () => {
    if (!vault || !draft || busy || !isDirty) return;
    setBusy(true);
    setSaveError(null);
    try {
      const settingsDirty = Boolean(baseline && !vaultSettingsEqual(draft, baseline));
      if (settingsDirty) {
        const normalized = normalizeVaultSettingsConfig(draft);
        await vaultService.registerSettings(vault.id, normalized);
        setBaseline(normalized);
        setDraft(normalized);
        onSaved(vault.id, vaultSettingsToListPatch(normalized));
      }
      if (groupDirty) {
        const assignment: CreateVaultGroupAssignment = pendingGroupName
          ? { kind: "create", displayName: pendingGroupName }
          : selectedGroupId
            ? { kind: "existing", groupId: selectedGroupId }
            : { kind: "none" };
        await onCommitGroupAssignment?.(vault.id, assignment);
        setNewGroupName("");
        setGroupNameError(null);
        if (assignment.kind === "create") {
          setSelectedGroupId(
            displayNameToGroupId(
              assignment.displayName,
              groups.map((group) => group.id),
            ),
          );
        }
      }
      showToast(t("modal.settings.saved"));
      setSavedVisible(true);
      clearTimeout(savedHideRef.current);
      savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
      setSaveConfirmOpen(false);
      onClose();
    } catch (caught) {
      setSaveError(t(mobileErrorI18nKey(caught)));
    } finally {
      setBusy(false);
    }
  }, [
    baseline,
    busy,
    draft,
    groupDirty,
    groups,
    isDirty,
    onClose,
    onCommitGroupAssignment,
    onSaved,
    pendingGroupName,
    selectedGroupId,
    showToast,
    t,
    vault,
    vaultService,
  ]);

  const handleSaveClick = () => {
    if (!isDirty || busy) return;
    if (pendingGroupName) {
      const validation = validateDisplayName(pendingGroupName);
      if (validation) {
        setGroupNameError(
          t(
            displayNameErrorI18nKey(validation),
            validation === "too_long"
              ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) }
              : undefined,
          ),
        );
        return;
      }
    }
    setGroupNameError(null);
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  if (!open || !vault) return null;

  const footer = (
    <View style={styles.footerCol}>
      <View>
        {discardConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
        ) : saveConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.save_confirm")}</Text>
        ) : saveError ? (
          <Text style={[typography.caption, { color: colors.onErrorContainer }]}>{saveError}</Text>
        ) : savedVisible ? (
          <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
            {t("modal.settings.saved")}
          </Text>
        ) : null}
      </View>
      {discardConfirmOpen ? (
        <View style={styles.footerRow}>
          <Button
            variant="danger"
            size="md"
            label={t("modal.settings.discard_confirm_action")}
            onPress={handleDiscardAndClose}
          />
          <Button
            variant="ghost"
            size="md"
            label={t("modal.settings.discard_keep_editing")}
            onPress={dismissFooterConfirm}
          />
        </View>
      ) : (
        <View style={styles.footerRow}>
          {!saveConfirmOpen ? (
            <Button
              size="md"
              variant="ghost"
              label={t("action.cancel")}
              onPress={requestClose}
              disabled={busy}
            />
          ) : null}
          <Button
            size="md"
            variant="primary"
            label={saveConfirmOpen ? t("modal.settings.save_confirm_action") : t("modal.settings.save")}
            onPress={() => {
              if (saveConfirmOpen) void persistDraft();
              else handleSaveClick();
            }}
            disabled={busy || !isDirty}
            busy={busy}
          />
          {saveConfirmOpen ? (
            <Button
              size="md"
              variant="ghost"
              label={t("modal.settings.save_cancel")}
              disabled={busy}
              onPress={dismissFooterConfirm}
            />
          ) : null}
        </View>
      )}
    </View>
  );

  return (
    <Modal
      open={open}
      title={t("modal.settings.title", { name: vault.displayName })}
      onClose={requestClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <View style={styles.body} onTouchStart={dismissFooterConfirm}>
        {loadTimedOut ? (
          <View style={styles.center}>
            <Text style={[typography.body, { color: colors.onErrorContainer }]} accessibilityRole="alert">
              {t("loading.timed_out")}
            </Text>
            <Button label={t("action.retry")} variant="accent" onPress={reload} />
          </View>
        ) : loadError ? (
          <View style={styles.center}>
            <Text style={[typography.body, { color: colors.onErrorContainer }]} accessibilityRole="alert">
              {loadError}
            </Text>
            <Button label={t("action.retry")} variant="accent" onPress={reload} />
          </View>
        ) : loading && loadBudget.visible ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <LoadingBudgetHint budgetMs={loadBudget.budgetMs} remainingMs={loadBudget.remainingMs} />
          </View>
        ) : draft ? (
          <VaultSettingsForm
            draft={draft}
            patchDraft={patchDraft}
            storageModeLocked={vault.session === "open"}
            groups={groups}
            selectedGroupId={selectedGroupId}
            newGroupName={newGroupName}
            nameError={groupNameError}
            onSelectedGroupIdChange={(groupId) => {
              setSelectedGroupId(groupId);
              setNewGroupName("");
              setGroupNameError(null);
              setSaveConfirmOpen(false);
              setDiscardConfirmOpen(false);
            }}
            onNewGroupNameChange={(name) => {
              setNewGroupName(name);
              setGroupNameError(null);
              setSaveConfirmOpen(false);
              setDiscardConfirmOpen(false);
            }}
          />
        ) : (
          <View style={styles.placeholder} accessibilityState={{ busy: true }} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  center: {
    gap: spacing.md,
    alignItems: "center",
    paddingVertical: spacing.xl,
    minHeight: 160,
  },
  placeholder: { minHeight: 160 },
  footerCol: { gap: spacing.sm },
  footerRow: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" },
});
