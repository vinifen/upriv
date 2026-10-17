import { useEffect, useId, useState } from "react";
import { Button, Modal, Toast } from "@/components/ui";
import { PathField } from "@/components/PathField";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { useAppSettingsContext } from "@/features/system/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useVaultRootService } from "@/platform/services";
import type { PlainFolderClass, PlainPlaceChoice } from "@upriv/shared";
import {
  plainFolderClassI18nKey,
  suggestedDefaultWorkspacePath,
  vaultRootPathForWorkspaceValidation,
} from "@upriv/shared";

interface PlainPlaceModalProps {
  open: boolean;
  vaultName: string;
  /** Shared workspace can change only when every vault is closed. */
  workspaceChoices: boolean;
  submitting: boolean;
  /** Set after a choice was saved and the folder is not a normal local disk. */
  warningClass: PlainFolderClass | null;
  onClose: () => void;
  onContinue: (choice: PlainPlaceChoice, path: string) => void;
  onAcceptWarning: () => void;
}

/** Asks where a plaintext vault's files go, before the password. */
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
  const { toast, showError, dismiss } = useErrorToast();
  const { settings } = useAppSettingsContext();
  const vaultRootService = useVaultRootService();
  const group = useId();
  const warningKey = warningClass ? plainFolderClassI18nKey(warningClass) : null;
  const [choice, setChoice] = useState<PlainPlaceChoice | null>(null);
  const [defaultPath, setDefaultPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [vaultPath, setVaultPath] = useState("");

  useEffect(() => {
    if (open) return;
    setChoice(null);
    setDefaultPath("");
    setCustomPath("");
    setVaultPath("");
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
      try {
        const picked = await vaultRootService.pickFolder(
          current.trim() || null,
          t("modal.app_settings.action.pick_workspace_folder"),
        );
        if (picked?.trim()) apply(picked.trim());
      } catch (error) {
        showError(error, "error.unexpected");
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
    <>
      <Modal
        open={open}
        title={t("plain.place.title")}
        titleIcon="folder"
        contextTitle={vaultName}
        onClose={() => {
          if (!submitting) onClose();
        }}
        panelClassName="max-w-lg"
        rootClassName="z-[140]"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
              {t("action.cancel")}
            </Button>
            {warningKey ? (
              <Button variant="primary" size="sm" disabled={submitting} onClick={onAcceptWarning}>
                {t("plain.confirm.action")}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={submitting || !canContinue || !choice}
                onClick={() => {
                  if (!choice || !canContinue) return;
                  const path =
                    choice === "custom" ? customPath : choice === "vault_only" ? vaultPath : "";
                  onContinue(choice, path.trim());
                }}
              >
                {t("action.continue")}
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">{t("plain.place.body")}</p>
          {warningKey ? (
            <p className="text-sm leading-relaxed text-on-surface-variant">{t(warningKey)}</p>
          ) : (
            <div role="radiogroup" aria-label={t("plain.place.title")} className="grid gap-2">
              {!workspaceChoices ? (
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  {t("plain.place.workspace_locked")}
                </p>
              ) : null}
              <PolicyRadioOption
                groupName={group}
                value="default"
                checked={choice === "default"}
                title={t("plain.place.default")}
                description={t("plain.place.default_desc")}
                disabled={submitting || !workspaceChoices}
                onSelect={() => setChoice("default")}
                footer={
                  choice === "default" ? <PathField value={defaultPath} readOnly /> : undefined
                }
              />
              <PolicyRadioOption
                groupName={group}
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
                groupName={group}
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
            </div>
          )}
        </div>
      </Modal>
      <Toast toast={toast} onDismiss={dismiss} className="z-[160]" />
    </>
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <PathField
        className="sm:flex-1"
        value={value}
        disabled={disabled}
        placeholder={t("modal.app_settings.field.workspace.path_placeholder")}
        onChange={onChange}
      />
      <Button
        type="button"
        variant="secondary"
        size="md"
        className="w-full shrink-0 sm:w-auto"
        disabled={disabled}
        onClick={onPick}
      >
        {t("modal.app_settings.action.pick_workspace_folder")}
      </Button>
    </div>
  );
}

interface PlainHeldModalProps {
  open: boolean;
  count: number;
  paths: readonly string[];
  submitting: boolean;
  onApply: () => void;
  onRestore: () => void;
}

/** Mass deletions from other apps stay in the vault until the user decides. */
export function PlainHeldModal({
  open,
  count,
  paths,
  submitting,
  onApply,
  onRestore,
}: PlainHeldModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={t("plain.held.title")}
      titleIcon="folder"
      onClose={onRestore}
      panelClassName="max-w-lg"
      rootClassName="z-[140]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={submitting} onClick={onRestore}>
            {t("plain.held.restore")}
          </Button>
          <Button variant="danger" size="sm" disabled={submitting} onClick={onApply}>
            {t("plain.held.apply")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("plain.held.body", { count: String(count) })}
        </p>
        {paths.length > 0 ? (
          <ul className="max-h-40 space-y-1 overflow-auto font-mono text-xs text-on-surface-variant">
            {paths.map((path) => (
              <li key={path} className="break-all">
                {path}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
