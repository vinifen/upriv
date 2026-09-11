import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  LOADING_BUDGET_MS,
  suggestedDefaultWorkspacePath,
  validateWorkspaceGlobalPath,
  workspacePathIssueI18nKey,
} from "@upriv/shared";
import { FieldHint, FieldLabel, PolicyRadioOption, ThemedInput } from "@/components/settings";
import {
  Button,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
  modalFooterConfirmBtnStyle,
} from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useVaultRootService } from "@/platform/services";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

type WorkspaceSetupMode = "default" | "custom";

interface WorkspaceSetupModalProps {
  open: boolean;
  /** Absolute vault-root path used to build the Default radio suggestion. */
  vaultRootPath: string;
  onCancel: () => void;
  /** Called after `[workspace].path` is saved successfully. */
  onConfigured: () => void;
}

/**
 * First-open prompt when app `[workspace].path` is unset and the vault uses
 * mount `"default"`. Radios: Default = `<vault-root>/workspace`, Custom = pick.
 */
export function WorkspaceSetupModal({
  open,
  vaultRootPath,
  onCancel,
  onConfigured,
}: WorkspaceSetupModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { patchSettings } = useAppSettingsContext();
  const vaultRoot = useVaultRootService();
  const suggested = suggestedDefaultWorkspacePath(vaultRootPath);
  const hasDefaultSuggestion = Boolean(suggested);
  const busyGen = useRef(0);
  const [mode, setMode] = useState<WorkspaceSetupMode>("default");
  const [customPath, setCustomPath] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const openedRef = useRef(false);
  const budget = useLoadingBudget(busy, LOADING_BUDGET_MS.settingsSave);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      busyGen.current += 1;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    busyGen.current += 1;
    setMode(hasDefaultSuggestion ? "default" : "custom");
    setCustomPath("");
    setConfirmOpen(false);
    setBusy(false);
    setError(null);
    submitLock.current = false;
  }, [open, hasDefaultSuggestion]);

  useEffect(() => {
    if (!budget.timedOut || !busy) return;
    busyGen.current += 1;
    submitLock.current = false;
    setBusy(false);
    setError(t("error.operation_timed_out"));
  }, [budget.timedOut, busy, t]);

  const chosenPath = mode === "default" ? suggested : customPath.trim();
  const pathIssue =
    mode === "custom"
      ? !customPath.trim()
        ? ("empty" as const)
        : validateWorkspaceGlobalPath(customPath, vaultRootPath)
      : !suggested
        ? ("empty" as const)
        : validateWorkspaceGlobalPath(suggested, vaultRootPath);
  const blocked = busy || pathIssue != null || !chosenPath;

  const requestContinue = useCallback(() => {
    if (blocked || confirmOpen) return;
    setConfirmOpen(true);
  }, [blocked, confirmOpen]);

  const commit = useCallback(() => {
    if (blocked || submitLock.current || !chosenPath) return;
    const generation = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const ok = await patchSettings({ workspace: { path: chosenPath } });
        if (generation !== busyGen.current) return;
        if (!ok) {
          setError(t("error.settings_save_failed"));
          setConfirmOpen(false);
          submitLock.current = false;
          setBusy(false);
          return;
        }
        setConfirmOpen(false);
        onConfigured();
        submitLock.current = false;
        setBusy(false);
      } catch (caught) {
        if (generation !== busyGen.current) return;
        setError(t(mobileErrorI18nKey(caught, "error.settings_save_failed")));
        setConfirmOpen(false);
        submitLock.current = false;
        setBusy(false);
      }
    })();
  }, [blocked, chosenPath, onConfigured, patchSettings, t]);

  if (!open) return null;

  const footer = (
    <View style={styles.footerCol}>
      {error ? (
        <Text
          style={[typography.caption, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : confirmOpen ? (
        <Text style={typography.bodyMuted}>{t("modal.workspace.setup.continue_confirm")}</Text>
      ) : null}
      {budget.visible ? (
        <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
      ) : null}
      <ModalFooterActions layout="confirm">
        <Button
          variant="primary"
          label={
            confirmOpen
              ? t("modal.workspace.setup.continue_confirm_action")
              : t("modal.workspace.setup.continue")
          }
          style={modalFooterConfirmBtnStyle}
          disabled={confirmOpen ? busy : blocked}
          busy={busy && confirmOpen}
          onPress={confirmOpen ? commit : requestContinue}
        />
        <Button
          variant="ghost"
          label={t("modal.settings.save_cancel")}
          style={modalFooterConfirmBtnStyle}
          disabled={busy}
          onPress={() => {
            if (confirmOpen) {
              setConfirmOpen(false);
              return;
            }
            onCancel();
          }}
        />
      </ModalFooterActions>
    </View>
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        if (confirmOpen) {
          setConfirmOpen(false);
          return;
        }
        onCancel();
      }}
      title={t("modal.workspace.setup.title")}
      titleIcon="folder"
      panelClassName="max-w-lg"
      dismissible={!busy}
      footer={footer}
    >
      <View style={styles.body}>
        <FieldHint>{t("modal.workspace.setup.intro")}</FieldHint>
        <View
          style={styles.options}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("modal.workspace.setup.title")}
        >
          {hasDefaultSuggestion ? (
            <PolicyRadioOption
              value="default"
              checked={mode === "default"}
              title={t("modal.workspace.setup.option.default")}
              description={t("modal.workspace.setup.option.default_desc", {
                path: suggested || "—",
              })}
              badge="default"
              onSelect={() => {
                setMode("default");
                setConfirmOpen(false);
                setError(null);
              }}
              footer={
                mode === "default" && pathIssue ? (
                  <Text
                    style={[typography.caption, { color: colors.onErrorContainer }]}
                    accessibilityRole="alert"
                  >
                    {t(workspacePathIssueI18nKey(pathIssue))}
                  </Text>
                ) : null
              }
            />
          ) : null}
          <PolicyRadioOption
            value="custom"
            checked={mode === "custom"}
            title={t("modal.workspace.setup.option.custom")}
            description={t("modal.workspace.setup.option.custom_desc")}
            onSelect={() => {
              setMode("custom");
              setConfirmOpen(false);
              setError(null);
            }}
            footer={
              mode === "custom" ? (
                <View style={styles.customFields}>
                  <FieldLabel>{t("modal.app_settings.field.workspace.path")}</FieldLabel>
                  <ThemedInput
                    value={customPath}
                    placeholder={t("modal.app_settings.field.workspace.path_placeholder")}
                    onChangeText={(path) => {
                      setCustomPath(path);
                      setConfirmOpen(false);
                      setError(null);
                    }}
                    mono
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label={t("modal.app_settings.action.pick_workspace_folder")}
                    disabled={Platform.OS !== "android"}
                    onPress={() => {
                      void (async () => {
                        try {
                          const picked = await vaultRoot.pickFolder(
                            customPath.trim() || suggested || null,
                            t("modal.app_settings.action.pick_workspace_folder"),
                          );
                          if (!picked?.trim()) return;
                          setCustomPath(picked.trim());
                          setConfirmOpen(false);
                          setError(null);
                        } catch (caught) {
                          setError(
                            t(mobileErrorI18nKey(caught, "modal.vault_root_setup.error_pick")),
                          );
                        }
                      })();
                    }}
                  />
                  {Platform.OS !== "android" ? (
                    <FieldHint>{t("error.unsupported_platform")}</FieldHint>
                  ) : null}
                  {pathIssue ? (
                    <Text
                      style={[typography.caption, { color: colors.onErrorContainer }]}
                      accessibilityRole="alert"
                    >
                      {t(workspacePathIssueI18nKey(pathIssue))}
                    </Text>
                  ) : null}
                </View>
              ) : null
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  options: {
    gap: spacing.sm,
  },
  customFields: {
    gap: spacing.sm,
  },
  footerCol: {
    gap: spacing.sm,
  },
});
