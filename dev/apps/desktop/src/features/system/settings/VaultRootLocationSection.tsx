import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PathField } from "@/components/PathField";
import { Button } from "@/components/ui";
import { PolicyRadioOption, SettingsField, SettingsFormGrid } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  VAULT_ROOT_ALIAS_FILE,
  diskFromDirStatus,
  isVaultRootDraftDirty,
  vaultRootDiskProblemKey,
  vaultRootDraftKey,
  vaultRootGateFromState,
  visibleVaultRootDisk,
  type AppDistribution,
  type AppSettingsConfig,
  type IncompleteReplacePolicy,
  type VaultRootDiskStatus,
  type VaultRootMode,
  type VaultRootSettingsGate,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useErrorToast } from "@/hooks/useErrorToast";
import { getAppVersion, getSessionAppVersion } from "@/lib/appVersion";
import { VaultRootIncompleteReplacePanel } from "./VaultRootIncompleteReplacePanel";

interface VaultRootLocationSectionProps {
  config: AppSettingsConfig["app"];
  onChange: (patch: Partial<AppSettingsConfig["app"]>) => void;
  savedVaultRootMode: VaultRootMode;
  savedRootPath: string;
  onVaultRootGateChange: (gate: VaultRootSettingsGate) => void;
  /** @default "apply" — Data folder. Pass `"continue"` for Setup / gate modals. */
  primaryAction?: "continue" | "apply";
  /** First-run Setup: always treat draft as dirty (no saved baseline). */
  forceDirty?: boolean;
  /** Replaces the default custom-root help/remembered copy (e.g. Setup alias notice). */
  customRootNotice?: ReactNode;
  /** Disable folder picker / radios while parent commit is busy. */
  controlsDisabled?: boolean;
  /** Bump to re-run inspect without changing mode/path (e.g. after setup RPC incomplete). */
  inspectNonce?: number;
}

/**
 * Shared vault-root mode/path picker (Data folder Apply, Setup Continue, …).
 */
export function VaultRootLocationSection({
  config,
  onChange,
  savedVaultRootMode,
  savedRootPath,
  onVaultRootGateChange,
  primaryAction = "apply",
  forceDirty = false,
  customRootNotice,
  controlsDisabled = false,
  inspectNonce = 0,
}: VaultRootLocationSectionProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const vaultRootService = useVaultRootService();
  const rootModeGroup = useId();
  const repairPolicyGroup = useId();
  const useDefaultRoot = config.vault_root_mode === "default_root";
  const aliasLoadGen = useRef(0);
  const checkGen = useRef(0);
  const draftIdentityRef = useRef({
    mode: config.vault_root_mode,
    path: config.upriv_root_path,
  });
  const draftCustomPathRef = useRef("");

  const [disk, setDisk] = useState<VaultRootDiskStatus>("ready");
  /** Draft key the current `disk` value was checked for. Empty until that check starts. */
  const [diskKey, setDiskKey] = useState("");
  const [recheckNonce, setRecheckNonce] = useState(0);
  const [replacePolicy, setReplacePolicy] = useState<IncompleteReplacePolicy | null>(null);
  const [customPathLoading, setCustomPathLoading] = useState(false);
  const [defaultRootAnchor, setDefaultRootAnchor] = useState("");
  const [rememberedCustomPath, setRememberedCustomPath] = useState("");
  const [recallError, setRecallError] = useState(false);
  const [distribution, setDistribution] = useState<AppDistribution>(
    () => getSessionAppVersion()?.distribution ?? "portable",
  );

  useEffect(() => {
    const fromDraft = config.upriv_root_path.trim();
    if (fromDraft) {
      draftCustomPathRef.current = fromDraft;
      setRememberedCustomPath(fromDraft);
      setRecallError(false);
      return;
    }
    if (draftCustomPathRef.current.trim()) return;
    let cancelled = false;
    void vaultRootService
      .readAlias()
      .then((alias) => {
        if (cancelled) return;
        const path = alias?.path.trim() ?? "";
        if (!path) return;
        draftCustomPathRef.current = path;
        setRememberedCustomPath(path);
        setRecallError(false);
      })
      .catch(() => {
        if (!cancelled) setRecallError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [config.upriv_root_path, vaultRootService]);

  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((info) => {
      if (!cancelled && info.distribution) setDistribution(info.distribution);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void vaultRootService
      .defaultRootStatus()
      .then((result) => {
        if (!cancelled) setDefaultRootAnchor(result.defaultRootAnchor);
      })
      .catch(() => {
        if (!cancelled) setDefaultRootAnchor("");
      });
    return () => {
      cancelled = true;
    };
  }, [vaultRootService]);

  const defaultRootTitleKey =
    distribution === "installed"
      ? "modal.app_settings.option.upriv_root.default_root_installed"
      : "modal.app_settings.option.upriv_root.default_root";
  const defaultRootDescKey =
    distribution === "installed"
      ? "modal.app_settings.option.upriv_root.default_root_desc_installed"
      : "modal.app_settings.option.upriv_root.default_root_desc";

  const dirty =
    forceDirty ||
    isVaultRootDraftDirty(
      config.vault_root_mode,
      config.upriv_root_path,
      savedVaultRootMode,
      savedRootPath,
    );
  const draftKey = vaultRootDraftKey(config.vault_root_mode, config.upriv_root_path);
  const visibleDisk = visibleVaultRootDisk(disk, diskKey, draftKey, dirty);
  const diskProblemKey = vaultRootDiskProblemKey(visibleDisk);
  const noteDisk = useCallback(
    (status: VaultRootDiskStatus) => {
      setDiskKey(draftKey);
      setDisk(status);
    },
    [draftKey],
  );
  const vaultRootGate = useMemo(
    () => vaultRootGateFromState({ dirty, disk: visibleDisk, replacePolicy, primaryAction }),
    [dirty, visibleDisk, primaryAction, replacePolicy],
  );

  /** Drop the previous draft's result and check again, even when the path string is unchanged. */
  const requestRecheck = () => {
    checkGen.current += 1;
    setDiskKey("");
    setDisk("checking");
    setRecheckNonce((n) => n + 1);
  };

  useLayoutEffect(() => {
    onVaultRootGateChange(vaultRootGate);
  }, [onVaultRootGateChange, vaultRootGate]);

  useEffect(() => {
    if (!dirty) {
      checkGen.current += 1;
      noteDisk("ready");
      setReplacePolicy(null);
      draftIdentityRef.current = {
        mode: config.vault_root_mode,
        path: config.upriv_root_path,
      };
      return;
    }

    const identityChanged =
      draftIdentityRef.current.mode !== config.vault_root_mode ||
      draftIdentityRef.current.path !== config.upriv_root_path;
    draftIdentityRef.current = {
      mode: config.vault_root_mode,
      path: config.upriv_root_path,
    };
    if (identityChanged) {
      setReplacePolicy(null);
    }

    const gen = ++checkGen.current;

    if (config.vault_root_mode === "default_root") {
      noteDisk("checking");
      void vaultRootService
        .defaultRootStatus()
        .then((result) => {
          if (gen !== checkGen.current) return;
          setDefaultRootAnchor(result.defaultRootAnchor);
          noteDisk(diskFromDirStatus(result.status));
        })
        .catch(() => {
          if (gen !== checkGen.current) return;
          noteDisk("unreadable");
        });
      return;
    }

    const path = config.upriv_root_path.trim();
    if (!path) {
      noteDisk(customPathLoading ? "checking" : "needs_folder");
      return;
    }

    noteDisk("checking");
    void vaultRootService
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== checkGen.current) return;
        noteDisk(diskFromDirStatus(result.status));
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        noteDisk("unreadable");
      });
  }, [
    config.vault_root_mode,
    config.upriv_root_path,
    dirty,
    customPathLoading,
    vaultRootService,
    inspectNonce,
    noteDisk,
    recheckNonce,
  ]);

  const retryDiskCheck = () => {
    noteDisk("checking");
    checkGen.current += 1;
    const gen = checkGen.current;
    if (config.vault_root_mode === "default_root") {
      void vaultRootService
        .defaultRootStatus()
        .then((result) => {
          if (gen !== checkGen.current) return;
          setDefaultRootAnchor(result.defaultRootAnchor);
          noteDisk(diskFromDirStatus(result.status));
        })
        .catch(() => {
          if (gen !== checkGen.current) return;
          noteDisk("unreadable");
        });
      return;
    }
    const path = config.upriv_root_path.trim();
    if (!path) {
      noteDisk("needs_folder");
      return;
    }
    void vaultRootService
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== checkGen.current) return;
        noteDisk(diskFromDirStatus(result.status));
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        noteDisk("unreadable");
      });
  };

  const showDefaultRootExtras = useDefaultRoot && dirty;
  const showCustomExtras = !useDefaultRoot;
  const customFieldPath = config.upriv_root_path.trim() || rememberedCustomPath;

  const retryRecall = () => {
    const stashed = draftCustomPathRef.current.trim();
    if (stashed) {
      setRememberedCustomPath(stashed);
      setRecallError(false);
      onChange({ vault_root_mode: "custom_root", upriv_root_path: stashed });
      return;
    }
    const gen = ++aliasLoadGen.current;
    setCustomPathLoading(true);
    setRecallError(false);
    void vaultRootService
      .readAlias()
      .then((alias) => {
        if (gen !== aliasLoadGen.current) return;
        const aliasPath = alias?.path.trim() || "";
        if (!aliasPath) return;
        draftCustomPathRef.current = aliasPath;
        setRememberedCustomPath(aliasPath);
        onChange({ vault_root_mode: "custom_root", upriv_root_path: aliasPath });
      })
      .catch(() => {
        if (gen !== aliasLoadGen.current) return;
        setRecallError(true);
      })
      .finally(() => {
        if (gen !== aliasLoadGen.current) return;
        setCustomPathLoading(false);
      });
  };

  const incompletePanel =
    dirty && visibleDisk === "incomplete" ? (
      <VaultRootIncompleteReplacePanel
        context={
          useDefaultRoot
            ? { kind: "default_root" }
            : { kind: "custom_root", path: config.upriv_root_path.trim() }
        }
        replacePolicy={replacePolicy}
        onReplacePolicyChange={setReplacePolicy}
        groupName={repairPolicyGroup}
        primaryAction={primaryAction}
        disabled={controlsDisabled}
      />
    ) : null;

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.app_settings.field.upriv_root_mode")}
        hint={t("modal.app_settings.field.upriv_root_mode_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.upriv_root_mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="default_root"
            checked={useDefaultRoot}
            attention={useDefaultRoot && vaultRootGate.blocksPrimary && visibleDisk !== "checking"}
            title={t(defaultRootTitleKey)}
            description={t(defaultRootDescKey)}
            badge="default"
            disabled={controlsDisabled}
            onSelect={() => {
              if (controlsDisabled) return;
              aliasLoadGen.current += 1;
              setCustomPathLoading(false);
              setReplacePolicy(null);
              requestRecheck();
              const current = config.upriv_root_path.trim();
              if (current) {
                draftCustomPathRef.current = current;
                setRememberedCustomPath(current);
                setRecallError(false);
              }
              onChange({ vault_root_mode: "default_root", upriv_root_path: "" });
            }}
            footer={
              <div className="space-y-2">
                {defaultRootAnchor ? (
                  <PathField value={defaultRootAnchor} readOnly />
                ) : (
                  <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                    {t("modal.app_settings.field.upriv_root_loading")}
                  </p>
                )}
                {showDefaultRootExtras ? (
                  <>
                    {visibleDisk === "checking" ? (
                      <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                        {t("modal.app_settings.field.upriv_root_loading")}
                      </p>
                    ) : null}
                    {visibleDisk === "will_create" ? (
                      <p
                        className="rounded-md bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface"
                        role="status"
                      >
                        {t(
                          primaryAction === "apply"
                            ? "modal.app_settings.upriv_root.switch_default_root_create_notice_apply"
                            : "modal.app_settings.upriv_root.switch_default_root_create_notice_continue",
                          {
                            file: VAULT_ROOT_ALIAS_FILE,
                          },
                        )}
                      </p>
                    ) : null}
                    {diskProblemKey ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p
                          className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                          role="alert"
                        >
                          {t(diskProblemKey)}
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          className="w-full shrink-0 sm:w-auto"
                          disabled={controlsDisabled}
                          onClick={retryDiskCheck}
                        >
                          {t("action.retry")}
                        </Button>
                      </div>
                    ) : null}
                    {incompletePanel}
                  </>
                ) : null}
              </div>
            }
          />
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="custom_root"
            checked={!useDefaultRoot}
            attention={!useDefaultRoot && vaultRootGate.blocksPrimary && visibleDisk !== "checking"}
            title={t("modal.app_settings.option.upriv_root.custom_root")}
            description={t("modal.app_settings.option.upriv_root.custom_root_desc", {
              file: VAULT_ROOT_ALIAS_FILE,
            })}
            disabled={controlsDisabled}
            onSelect={() => {
              if (controlsDisabled) return;
              const current = config.upriv_root_path.trim();
              setReplacePolicy(null);
              requestRecheck();
              if (current) {
                draftCustomPathRef.current = current;
                setRememberedCustomPath(current);
                setRecallError(false);
                onChange({ vault_root_mode: "custom_root", upriv_root_path: current });
                return;
              }
              const stashed = draftCustomPathRef.current.trim();
              if (stashed) {
                setRememberedCustomPath(stashed);
                setRecallError(false);
                onChange({ vault_root_mode: "custom_root", upriv_root_path: stashed });
                return;
              }
              const gen = ++aliasLoadGen.current;
              setCustomPathLoading(true);
              setRecallError(false);
              onChange({ vault_root_mode: "custom_root", upriv_root_path: "" });
              void vaultRootService
                .readAlias()
                .then((alias) => {
                  if (gen !== aliasLoadGen.current) return;
                  const aliasPath = alias?.path.trim() || "";
                  if (aliasPath) {
                    draftCustomPathRef.current = aliasPath;
                    setRememberedCustomPath(aliasPath);
                  }
                  onChange({
                    vault_root_mode: "custom_root",
                    upriv_root_path: aliasPath,
                  });
                })
                .catch(() => {
                  if (gen !== aliasLoadGen.current) return;
                  setRecallError(true);
                })
                .finally(() => {
                  if (gen !== aliasLoadGen.current) return;
                  setCustomPathLoading(false);
                });
            }}
            footer={
              <div className="space-y-2">
                {customRootNotice ?? (
                  <p className="text-xs leading-relaxed text-on-surface-variant">
                    {t("modal.app_settings.field.upriv_root_help")}
                  </p>
                )}
                {showCustomExtras && !customRootNotice ? (
                  <>
                    {config.upriv_root_path.trim() ? (
                      <p className="text-xs leading-relaxed text-on-surface-variant">
                        {t("modal.app_settings.field.upriv_root_remembered", {
                          file: VAULT_ROOT_ALIAS_FILE,
                        })}
                      </p>
                    ) : customPathLoading || visibleDisk === "checking" ? (
                      <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                        {t("modal.app_settings.field.upriv_root_loading")}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {useDefaultRoot && customFieldPath ? (
                  <p className="text-xs leading-relaxed text-on-surface-variant">
                    {t("modal.app_settings.field.upriv_root_kept_with_default")}
                  </p>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <PathField
                    className="sm:flex-1"
                    value={customFieldPath}
                    readOnly
                    placeholder={t("modal.app_settings.field.upriv_root_placeholder")}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    className="w-full shrink-0 sm:w-auto"
                    disabled={customPathLoading || controlsDisabled}
                    onClick={() => {
                      const suggested = customFieldPath.trim();
                      setReplacePolicy(null);
                      void (async () => {
                        try {
                          const defaultPath = suggested
                            ? suggested
                            : (await vaultRootService
                                .readAlias()
                                .then((alias) => alias?.path.trim() || "")
                                .catch(() => "")) ||
                              (await vaultRootService.suggestedCustomRootPath().catch(() => ""));
                          const picked = await vaultRootService.pickFolder(
                            defaultPath || null,
                            t("modal.vault_root_setup.pick_folder_title"),
                          );
                          if (!picked?.trim()) return;
                          draftCustomPathRef.current = picked.trim();
                          setRememberedCustomPath(picked.trim());
                          setRecallError(false);
                          requestRecheck();
                          onChange({
                            vault_root_mode: "custom_root",
                            upriv_root_path: picked.trim(),
                          });
                        } catch (error) {
                          showError(error, "error.unexpected");
                        }
                      })();
                    }}
                  >
                    {t("modal.app_settings.action.choose_folder")}
                  </Button>
                </div>
                {recallError ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p
                      className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                      role="alert"
                    >
                      {t("modal.vault_root_setup.error_io")}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      className="w-full shrink-0 sm:w-auto"
                      disabled={controlsDisabled}
                      onClick={retryRecall}
                    >
                      {t("action.retry")}
                    </Button>
                  </div>
                ) : null}
                {showCustomExtras && diskProblemKey ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p
                      className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                      role="alert"
                    >
                      {t(diskProblemKey)}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      className="w-full shrink-0 sm:w-auto"
                      disabled={controlsDisabled}
                      onClick={retryDiskCheck}
                    >
                      {t("action.retry")}
                    </Button>
                  </div>
                ) : null}
                {showCustomExtras && visibleDisk === "needs_folder" ? (
                  <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                    {t("modal.vault_root_setup.error_path_required")}
                  </p>
                ) : null}
                {showCustomExtras ? incompletePanel : null}
              </div>
            }
          />
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}
