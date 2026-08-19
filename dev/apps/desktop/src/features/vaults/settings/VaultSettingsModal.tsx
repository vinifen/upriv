import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useVaultService } from "@/platform/services";
import {
  VaultSettingsBackupSection,
  VaultSettingsCloseSection,
  VaultSettingsDangerZoneSection,
  VaultSettingsPolicySection,
  VaultSettingsSecuritySection,
  VaultSettingsSevenZipSection,
  VaultSettingsStorageSection,
  VaultSettingsVaultSection,
  VaultSettingsGroupSection,
  VaultSettingsSection,
} from "@/components/settings";
import { useVaultSettings } from "./hooks/useVaultSettings";
import type {
  CloseDefaultAction,
  CreateVaultGroupAssignment,
  StorageMode,
  VaultGroup,
  VaultListItem,
  VaultSettingsConfig,
  VaultSettingsListPatch,
  VaultSettingsSectionId,
} from "@upriv/shared";
import {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  displayNameErrorI18nKey,
  displayNameToGroupId,
  normalizeVaultSettingsConfig,
  patchCloseDefaultAction,
  patchStorageMode,
  storageModeCanSeal,
  validateDisplayName,
  vaultSettingsEqual,
  vaultSettingsSectionsForStorage,
  vaultSettingsToListPatch,
} from "@upriv/shared";

const SAVED_INDICATOR_MS = 1500;

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  groups?: VaultGroup[];
  onVaultSettingsSaved?: (vaultId: string, patch: VaultSettingsListPatch) => void;
  onCommitGroupAssignment?: (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => Promise<void> | void;
  onVaultDelete?: (vaultId: string) => void;
}

export function VaultSettingsModal({
  vault,
  open,
  onClose,
  groups = [],
  onVaultSettingsSaved,
  onCommitGroupAssignment,
  onVaultDelete,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const vaultService = useVaultService();
  const vaultId = vault?.id ?? null;
  const { config, replaceConfig } = useVaultSettings(vaultId, open);

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  const confirmInputId = useId();
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedForVaultRef = useRef<string | null>(null);
  const encryptedClosePreferenceRef = useRef<CloseDefaultAction>("close");
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const canConfirmDelete = vault !== null && deleteConfirm.trim() === vault.id;

  const baseline = useMemo(() => (config ? normalizeVaultSettingsConfig(config) : null), [config]);

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

  useEffect(() => {
    if (!open) return;
    if (!config || !vaultId) return;

    const isNewSession = openedForVaultRef.current !== vaultId;
    if (!isNewSession) return;

    openedForVaultRef.current = vaultId;
    setDraft(normalizeVaultSettingsConfig(config));
    setSelectedGroupId(
      groupsRef.current.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "",
    );
    setNewGroupName("");
    setGroupNameError(null);
    if (storageModeCanSeal(config.storage.mode)) {
      encryptedClosePreferenceRef.current = config.close.default_action;
    }
  }, [open, vaultId, config]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      openedForVaultRef.current = null;
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setDeleteOpen(false);
      setDeleteConfirm("");
      setSelectedGroupId("");
      setNewGroupName("");
      setGroupNameError(null);
    }
  }, [open, vaultId]);

  useEffect(() => {
    if (!isDirty) setSaveConfirmOpen(false);
  }, [isDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  const persistDraft = useCallback(
    async (next: VaultSettingsConfig) => {
      if (!vaultId) return;
      const normalized = normalizeVaultSettingsConfig(next);
      try {
        await vaultService.registerSettings(vaultId, normalized);
        replaceConfig(normalized);
        setDraft(normalized);
        if (groupDirty) {
          const assignment: CreateVaultGroupAssignment = pendingGroupName
            ? { kind: "create", displayName: pendingGroupName }
            : selectedGroupId
              ? { kind: "existing", groupId: selectedGroupId }
              : { kind: "none" };
          await onCommitGroupAssignment?.(vaultId, assignment);
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
        onVaultSettingsSaved?.(vaultId, vaultSettingsToListPatch(normalized));
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
      } catch (error) {
        showError(error, "error.settings_save_failed");
      }
    },
    [
      vaultId,
      replaceConfig,
      onVaultSettingsSaved,
      onCommitGroupAssignment,
      groupDirty,
      pendingGroupName,
      selectedGroupId,
      groups,
      showError,
      vaultService,
    ],
  );

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof VaultSettingsConfig>(section: S, patch: Partial<VaultSettingsConfig[S]>) => {
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
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

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    onClose();
  };

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

  const handleSaveClick = () => {
    if (!isDirty) return;
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

  const handleConfirmSave = () => {
    if (!draft || !isDirty) return;
    void persistDraft(draft).then(() => setSaveConfirmOpen(false));
  };

  const handleConfirmDelete = () => {
    if (!canConfirmDelete || !vault) return;
    onVaultDelete?.(vault.id);
    handleClose();
  };

  const formConfig = draft ?? config;
  if (!open || !vault || !formConfig) return null;

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm sm:min-w-0 sm:flex-1" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : saveConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.save_confirm")}</p>
        ) : savedVisible ? (
          <p className="text-vault-open">{t("modal.settings.saved")}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
        {discardConfirmOpen ? (
          <>
            <Button variant="danger" size="md" onClick={handleDiscardAndClose}>
              {t("modal.settings.discard_confirm_action")}
            </Button>
            <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
              {t("modal.settings.discard_keep_editing")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="md"
              disabled={!isDirty}
              onClick={saveConfirmOpen ? handleConfirmSave : handleSaveClick}
            >
              {saveConfirmOpen ? t("modal.settings.save_confirm_action") : t("modal.settings.save")}
            </Button>
            {saveConfirmOpen ? (
              <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
                {t("modal.settings.save_cancel")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title={t("modal.settings.title", { name: vault.displayName })}
      onClose={requestClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <div
        className="space-y-1.5 sm:space-y-2"
        onPointerDown={() => {
          if (discardConfirmOpen || saveConfirmOpen) dismissFooterConfirm();
        }}
      >
        {vaultSettingsSectionsForStorage(formConfig.storage.mode).map((sectionId) => (
          <VaultSettingsSection
            key={sectionId}
            title={t(`modal.settings.section.${sectionId}`)}
            defaultOpen={sectionId === "vault"}
          >
            {renderSettingsSection(sectionId, formConfig, patchDraft, vault.session === "open")}
          </VaultSettingsSection>
        ))}

        <VaultSettingsSection title={t("vault.group.assignment.section")}>
          <VaultSettingsGroupSection
            groups={groups}
            selectedGroupId={selectedGroupId}
            newGroupName={newGroupName}
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
          {groupNameError ? (
            <p className="mt-2 text-sm text-on-error-container">{groupNameError}</p>
          ) : null}
        </VaultSettingsSection>

        <VaultSettingsSection
          key={deleteOpen ? "danger-zone-open" : "danger-zone"}
          title={t("modal.settings.danger_zone")}
          tone="danger"
          defaultOpen={deleteOpen}
        >
          <VaultSettingsDangerZoneSection
            vaultId={vault.id}
            deleteOpen={deleteOpen}
            deleteConfirm={deleteConfirm}
            confirmInputId={confirmInputId}
            canConfirmDelete={canConfirmDelete}
            onRequestDelete={() => {
              setDeleteOpen(true);
              setDeleteConfirm("");
            }}
            onCancelDelete={() => {
              setDeleteOpen(false);
              setDeleteConfirm("");
            }}
            onConfirmDelete={handleConfirmDelete}
            onConfirmChange={setDeleteConfirm}
          />
        </VaultSettingsSection>
      </div>
    </Modal>
  );
}

function renderSettingsSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: <S extends keyof VaultSettingsConfig>(
    section: S,
    patch: Partial<VaultSettingsConfig[S]>,
  ) => void,
  storageModeLocked: boolean,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSettingsVaultSection
          config={draft.vault}
          onChange={(patch) => patchDraft("vault", patch)}
        />
      );
    case "storage":
      return (
        <VaultSettingsStorageSection
          config={draft.storage}
          storageModeLocked={storageModeLocked}
          onChange={(patch) => patchDraft("storage", patch)}
        />
      );
    case "close":
      return (
        <VaultSettingsCloseSection
          storageMode={draft.storage.mode}
          close={draft.close}
          autoClose={draft.auto_close}
          secureWipe={draft.security.secure_wipe_workspace}
          requireUnmountOnSleep={draft.policy.require_unmount_on_sleep}
          onCloseChange={(patch) => patchDraft("close", patch)}
          onAutoCloseChange={(patch) => patchDraft("auto_close", patch)}
          onSecureWipeChange={(secure_wipe_workspace) =>
            patchDraft("security", { secure_wipe_workspace })
          }
          onRequireUnmountOnSleepChange={(require_unmount_on_sleep) =>
            patchDraft("policy", { require_unmount_on_sleep })
          }
        />
      );
    case "backup":
      return (
        <VaultSettingsBackupSection
          config={draft.backup}
          onChange={(patch) => patchDraft("backup", patch)}
        />
      );
    case "security":
      return (
        <VaultSettingsSecuritySection
          storageMode={draft.storage.mode}
          config={draft.security}
          passwordHint={draft.vault.password_hint}
          onChange={(patch) => patchDraft("security", patch)}
          onPasswordHintChange={(password_hint) => patchDraft("vault", { password_hint })}
        />
      );
    case "seven_zip":
      return (
        <VaultSettingsSevenZipSection
          config={draft.seven_zip}
          onChange={(patch) => patchDraft("seven_zip", patch)}
        />
      );
    case "policy":
      return (
        <VaultSettingsPolicySection
          config={draft.policy}
          onChange={(patch) => patchDraft("policy", patch)}
        />
      );
    default:
      return null;
  }
}
