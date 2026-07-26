import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui";
import {
  PolicyRadioOption,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
} from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  VAULT_ROOT_ALIAS_FILE,
  type AppDistribution,
  type AppSettingsConfig,
  type IncompleteReplacePolicy,
  type VaultRootMode,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { getAppVersion, getSessionAppVersion } from "@/lib/appVersion";
import {
  isVaultRootDraftDirty,
  vaultRootGateFromState,
  type VaultRootDiskStatus,
  type VaultRootSettingsGate,
} from "./vaultRootSettingsIntent";
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
  const [replacePolicy, setReplacePolicy] = useState<IncompleteReplacePolicy | null>(null);
  const [customPathLoading, setCustomPathLoading] = useState(false);
  const [defaultRootAnchor, setDefaultRootAnchor] = useState("");
  const [distribution, setDistribution] = useState<AppDistribution>(
    () => getSessionAppVersion()?.distribution ?? "portable",
  );

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
  const vaultRootGate = useMemo(
    () => vaultRootGateFromState({ dirty, disk, replacePolicy, primaryAction }),
    [dirty, disk, primaryAction, replacePolicy],
  );

  useLayoutEffect(() => {
    onVaultRootGateChange(vaultRootGate);
  }, [onVaultRootGateChange, vaultRootGate]);

  useEffect(() => {
    if (!dirty) {
      checkGen.current += 1;
      setDisk("ready");
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
      setDisk("checking");
      void vaultRootService
        .defaultRootStatus()
        .then((result) => {
          if (gen !== checkGen.current) return;
          setDefaultRootAnchor(result.defaultRootAnchor);
          if (result.status === "incomplete") setDisk("incomplete");
          else if (result.status === "unreadable") setDisk("unreadable");
          else if (result.status === "absent") setDisk("will_create");
          else setDisk("ready");
        })
        .catch(() => {
          if (gen !== checkGen.current) return;
          setDisk("unreadable");
        });
      return;
    }

    const path = config.upriv_root_path.trim();
    if (!path) {
      setDisk(customPathLoading ? "checking" : "needs_folder");
      return;
    }

    setDisk("checking");
    void vaultRootService
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== checkGen.current) return;
        if (result.status === "incomplete") setDisk("incomplete");
        else if (result.status === "unreadable") setDisk("unreadable");
        else if (result.status === "absent") setDisk("will_create");
        else setDisk("ready");
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        setDisk("unreadable");
      });
  }, [
    config.vault_root_mode,
    config.upriv_root_path,
    dirty,
    customPathLoading,
    vaultRootService,
    inspectNonce,
  ]);

  const retryDiskCheck = () => {
    setDisk("checking");
    checkGen.current += 1;
    const gen = checkGen.current;
    if (config.vault_root_mode === "default_root") {
      void vaultRootService
        .defaultRootStatus()
        .then((result) => {
          if (gen !== checkGen.current) return;
          setDefaultRootAnchor(result.defaultRootAnchor);
          if (result.status === "incomplete") setDisk("incomplete");
          else if (result.status === "unreadable") setDisk("unreadable");
          else if (result.status === "absent") setDisk("will_create");
          else setDisk("ready");
        })
        .catch(() => {
          if (gen !== checkGen.current) return;
          setDisk("unreadable");
        });
      return;
    }
    const path = config.upriv_root_path.trim();
    if (!path) {
      setDisk("needs_folder");
      return;
    }
    void vaultRootService
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== checkGen.current) return;
        if (result.status === "incomplete") setDisk("incomplete");
        else if (result.status === "unreadable") setDisk("unreadable");
        else if (result.status === "absent") setDisk("will_create");
        else setDisk("ready");
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        setDisk("unreadable");
      });
  };

  const showDefaultRootExtras = useDefaultRoot && dirty;
  const showCustomExtras = !useDefaultRoot;

  const incompletePanel =
    dirty && disk === "incomplete" ? (
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
            attention={useDefaultRoot && vaultRootGate.blocksPrimary && disk !== "checking"}
            title={t(defaultRootTitleKey)}
            description={t(defaultRootDescKey)}
            badge="default"
            onSelect={() => {
              if (controlsDisabled) return;
              aliasLoadGen.current += 1;
              setCustomPathLoading(false);
              setReplacePolicy(null);
              const current = config.upriv_root_path.trim();
              if (current) draftCustomPathRef.current = current;
              onChange({ vault_root_mode: "default_root", upriv_root_path: "" });
            }}
            footer={
              useDefaultRoot ? (
                <div className="space-y-2">
                  {defaultRootAnchor ? (
                    <p className="break-all rounded-md bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                      {defaultRootAnchor}
                    </p>
                  ) : (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </p>
                  )}
                  {showDefaultRootExtras ? (
                    <>
                      {disk === "checking" ? (
                        <p
                          className="text-xs leading-relaxed text-on-surface-variant"
                          role="status"
                        >
                          {t("modal.app_settings.field.upriv_root_loading")}
                        </p>
                      ) : null}
                      {disk === "will_create" ? (
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
                      {disk === "unreadable" ? (
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
              ) : null
            }
          />
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="custom_root"
            checked={!useDefaultRoot}
            attention={!useDefaultRoot && vaultRootGate.blocksPrimary && disk !== "checking"}
            title={t("modal.app_settings.option.upriv_root.custom_root")}
            description={t("modal.app_settings.option.upriv_root.custom_root_desc", {
              file: VAULT_ROOT_ALIAS_FILE,
            })}
            onSelect={() => {
              if (controlsDisabled) return;
              const current = config.upriv_root_path.trim();
              setReplacePolicy(null);
              if (current) {
                onChange({ vault_root_mode: "custom_root", upriv_root_path: current });
                return;
              }
              const stashed = draftCustomPathRef.current.trim();
              if (stashed) {
                onChange({ vault_root_mode: "custom_root", upriv_root_path: stashed });
                return;
              }
              const gen = ++aliasLoadGen.current;
              setCustomPathLoading(true);
              onChange({ vault_root_mode: "custom_root", upriv_root_path: "" });
              void vaultRootService
                .readAlias()
                .then((alias) => {
                  if (gen !== aliasLoadGen.current) return;
                  onChange({
                    vault_root_mode: "custom_root",
                    upriv_root_path: alias?.path.trim() || "",
                  });
                })
                .finally(() => {
                  if (gen !== aliasLoadGen.current) return;
                  setCustomPathLoading(false);
                });
            }}
            footer={
              showCustomExtras ? (
                <div className="space-y-2">
                  {customRootNotice ?? (
                    <>
                      <p className="text-xs leading-relaxed text-on-surface-variant">
                        {t("modal.app_settings.field.upriv_root_help")}
                      </p>
                      {config.upriv_root_path.trim() ? (
                        <p className="text-xs leading-relaxed text-on-surface-variant">
                          {t("modal.app_settings.field.upriv_root_remembered", {
                            file: VAULT_ROOT_ALIAS_FILE,
                          })}
                        </p>
                      ) : customPathLoading || disk === "checking" ? (
                        <p
                          className="text-xs leading-relaxed text-on-surface-variant"
                          role="status"
                        >
                          {t("modal.app_settings.field.upriv_root_loading")}
                        </p>
                      ) : null}
                    </>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <input
                      type="text"
                      readOnly
                      value={config.upriv_root_path}
                      placeholder={t("modal.app_settings.field.upriv_root_placeholder")}
                      className={[
                        settingsControlClass,
                        "font-mono text-xs sm:min-w-0 sm:flex-1",
                      ].join(" ")}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      className="w-full shrink-0 sm:w-auto"
                      disabled={customPathLoading || controlsDisabled}
                      onClick={() => {
                        const suggested = config.upriv_root_path.trim();
                        setReplacePolicy(null);
                        void (async () => {
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
                          onChange({
                            vault_root_mode: "custom_root",
                            upriv_root_path: picked.trim(),
                          });
                        })();
                      }}
                    >
                      {t("modal.app_settings.action.choose_folder")}
                    </Button>
                  </div>
                  {disk === "unreadable" ? (
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
                        onClick={retryDiskCheck}
                      >
                        {t("action.retry")}
                      </Button>
                    </div>
                  ) : null}
                  {disk === "needs_folder" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.vault_root_setup.error_path_required")}
                    </p>
                  ) : null}
                  {incompletePanel}
                </div>
              ) : null
            }
          />
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}
