import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
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
import { PathField } from "@/components/PathField";
import { useVaultRootService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Button } from "@/components/ui";
import { FieldHint, FieldLabel, PolicyRadioOption } from "@/components/settings";
import { getMobileAppVersion } from "@/lib/appVersion";
import { isAndroidSafUri } from "@/platform/native/pickVaultRootFolder";
import {
  isAndroidDocumentsDefaultGrant,
  rememberedCustomFolderPath,
} from "@/platform/native/documentsGrant";
import { releaseIfDocumentsRoot } from "./dataFolderGrant";
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
  /** Replaces the default custom-root help copy (e.g. Setup alias notice). */
  customRootNotice?: ReactNode;
  /** Disable folder picker / radios while parent commit is busy. */
  controlsDisabled?: boolean;
  /** Bump to re-run inspect without changing mode/path (e.g. after setup RPC incomplete). */
  inspectNonce?: number;
}

/**
 * RN parity for desktop `VaultRootLocationSection`.
 *
 * Same rich-field pattern: mode radios (`default_root` / `custom_root`), path
 * field with folder picker (SAF-aware on Android — the URI is read-only),
 * live inspect via `defaultRootStatus` / `inspectAtPath`, incomplete replace
 * panel, and gate reporting via `onVaultRootGateChange`.
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
  const { colors, typography } = useTheme();
  const vaultRootService = useVaultRootService();
  const android = Platform.OS === "android";
  const useDefaultRoot = android
    ? config.vault_root_mode === "default_root" ||
      isAndroidDocumentsDefaultGrant(config.upriv_root_path)
    : config.vault_root_mode === "default_root";
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
  const [pickError, setPickError] = useState<string | null>(null);
  const [rememberedCustomPath, setRememberedCustomPath] = useState("");
  const [recallError, setRecallError] = useState(false);
  const [distribution, setDistribution] = useState<AppDistribution>(
    () => getMobileAppVersion().distribution,
  );

  useEffect(() => {
    setDistribution(getMobileAppVersion().distribution);
  }, []);

  const keepCustomPath = useCallback((candidate: string) => {
    const kept = rememberedCustomFolderPath(candidate);
    if (!kept) return "";
    draftCustomPathRef.current = kept;
    setRememberedCustomPath(kept);
    setRecallError(false);
    return kept;
  }, []);

  useEffect(() => {
    const fromDraft = rememberedCustomFolderPath(config.upriv_root_path);
    if (fromDraft) {
      keepCustomPath(fromDraft);
      return;
    }
    if (draftCustomPathRef.current.trim()) return;
    let cancelled = false;
    void vaultRootService
      .readAlias()
      .then((alias) => {
        if (cancelled) return;
        const stored = rememberedCustomFolderPath(alias?.customPath || alias?.path || "");
        if (stored) keepCustomPath(stored);
      })
      .catch(() => {
        if (!cancelled && !draftCustomPathRef.current.trim()) setRecallError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [config.upriv_root_path, keepCustomPath, vaultRootService]);

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
  const defaultRootDescKey = android
    ? "modal.app_settings.option.upriv_root.default_root_desc_android"
    : distribution === "installed"
      ? "modal.app_settings.option.upriv_root.default_root_desc_installed"
      : "modal.app_settings.option.upriv_root.default_root_desc";
  const customRootDescKey = android
    ? "modal.app_settings.option.upriv_root.custom_root_desc_android"
    : "modal.app_settings.option.upriv_root.custom_root_desc";

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
  const requestRecheck = useCallback(() => {
    checkGen.current += 1;
    setDiskKey("");
    setDisk("checking");
    setRecheckNonce((n) => n + 1);
  }, []);

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

    if (config.vault_root_mode === "default_root" && android) {
      noteDisk("will_create");
      return;
    }

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
    android,
  ]);

  const retryDiskCheck = useCallback(() => {
    noteDisk("checking");
    checkGen.current += 1;
    const gen = checkGen.current;
    if (config.vault_root_mode === "default_root" && android) {
      noteDisk("will_create");
      return;
    }
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
  }, [android, config.upriv_root_path, config.vault_root_mode, noteDisk, vaultRootService]);

  const pickCustomFolder = useCallback(() => {
    if (controlsDisabled) return;
    setReplacePolicy(null);
    void (async () => {
      const suggested =
        rememberedCustomFolderPath(config.upriv_root_path) ||
        rememberedCustomFolderPath(draftCustomPathRef.current);
      const defaultPath = suggested
        ? suggested
        : (await vaultRootService
            .readAlias()
            .then((alias) => rememberedCustomFolderPath(alias?.path ?? ""))
            .catch(() => "")) || (await vaultRootService.suggestedCustomRootPath().catch(() => ""));
      const picked = await vaultRootService.pickFolder(
        defaultPath || null,
        t("modal.vault_root_setup.pick_folder_title"),
      );
      if (!picked?.trim()) return;
      if (releaseIfDocumentsRoot(picked)) {
        setPickError(t("modal.vault_root_setup.documents_grant_rejected"));
        return;
      }
      setPickError(null);
      const pickedPath = keepCustomPath(picked) || picked.trim();
      requestRecheck();
      onChange({
        vault_root_mode: "custom_root",
        upriv_root_path: pickedPath,
      });
    })();
  }, [
    config.upriv_root_path,
    controlsDisabled,
    keepCustomPath,
    onChange,
    requestRecheck,
    t,
    vaultRootService,
  ]);

  const retryRecall = useCallback(() => {
    const stashed = rememberedCustomFolderPath(draftCustomPathRef.current);
    if (stashed) {
      keepCustomPath(stashed);
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
        const aliasPath = keepCustomPath(alias?.path ?? "");
        if (!aliasPath) return;
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
  }, [keepCustomPath, onChange, vaultRootService]);

  const showDefaultRootExtras = useDefaultRoot && dirty;
  const showCustomExtras = !useDefaultRoot;

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
        primaryAction={primaryAction}
        disabled={controlsDisabled}
      />
    ) : null;

  const customFieldPath =
    rememberedCustomFolderPath(config.upriv_root_path) || rememberedCustomPath;
  const pathIsSaf = isAndroidSafUri(customFieldPath);

  return (
    <View style={styles.wrap}>
      <FieldLabel>{t("modal.app_settings.field.upriv_root_mode")}</FieldLabel>
      <FieldHint>{t("modal.app_settings.field.upriv_root_mode_help")}</FieldHint>
      <View
        style={styles.options}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("modal.app_settings.field.upriv_root_mode")}
      >
        <PolicyRadioOption
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
            keepCustomPath(config.upriv_root_path);
            requestRecheck();
            onChange({ vault_root_mode: "default_root", upriv_root_path: "" });
          }}
          footer={
            <View style={styles.footerCol}>
              {android ? (
                <PathField
                  value={t("modal.app_settings.option.upriv_root.android_documents_path")}
                  editable={false}
                />
              ) : defaultRootAnchor ? (
                <PathField value={defaultRootAnchor} editable={false} />
              ) : (
                <Text style={typography.caption}>
                  {t("modal.app_settings.field.upriv_root_loading")}
                </Text>
              )}
              {showDefaultRootExtras ? (
                <>
                  {visibleDisk === "checking" ? (
                    <Text style={typography.caption}>
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </Text>
                  ) : null}
                  {visibleDisk === "will_create" ? (
                    <Text style={typography.caption}>
                      {android
                        ? t("modal.app_settings.upriv_root.android_default_confirm_notice")
                        : t(
                            primaryAction === "apply"
                              ? "modal.app_settings.upriv_root.switch_default_root_create_notice_apply"
                              : "modal.app_settings.upriv_root.switch_default_root_create_notice_continue",
                            { file: VAULT_ROOT_ALIAS_FILE },
                          )}
                    </Text>
                  ) : null}
                  {diskProblemKey ? (
                    <View style={styles.errorRow}>
                      <Text
                        style={[
                          typography.caption,
                          styles.errorText,
                          { color: colors.onErrorContainer },
                        ]}
                        accessibilityRole="alert"
                      >
                        {t(diskProblemKey)}
                      </Text>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={t("action.retry")}
                        disabled={controlsDisabled}
                        onPress={retryDiskCheck}
                      />
                    </View>
                  ) : null}
                  {incompletePanel}
                </>
              ) : null}
            </View>
          }
        />
        <PolicyRadioOption
          value="custom_root"
          checked={!useDefaultRoot}
          attention={!useDefaultRoot && vaultRootGate.blocksPrimary && visibleDisk !== "checking"}
          title={t("modal.app_settings.option.upriv_root.custom_root")}
          description={t(customRootDescKey, {
            file: VAULT_ROOT_ALIAS_FILE,
          })}
          disabled={controlsDisabled}
          onSelect={() => {
            if (controlsDisabled) return;
            setReplacePolicy(null);
            requestRecheck();
            const current = rememberedCustomFolderPath(config.upriv_root_path);
            const stashed = rememberedCustomFolderPath(draftCustomPathRef.current);
            const kept = current || stashed;
            if (kept) {
              keepCustomPath(kept);
              onChange({ vault_root_mode: "custom_root", upriv_root_path: kept });
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
                const aliasPath = keepCustomPath(alias?.path ?? "");
                if (!aliasPath) return;
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
            <View style={styles.footerCol}>
              {customRootNotice ?? (
                <Text style={typography.caption}>
                  {t("modal.app_settings.field.upriv_root_help")}
                </Text>
              )}
              {showCustomExtras && !customRootNotice ? (
                <>
                  {config.upriv_root_path.trim() ? (
                    <Text style={typography.caption}>
                      {t("modal.app_settings.field.upriv_root_remembered", {
                        file: VAULT_ROOT_ALIAS_FILE,
                      })}
                    </Text>
                  ) : customPathLoading || visibleDisk === "checking" ? (
                    <Text style={typography.caption}>
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {useDefaultRoot && customFieldPath ? (
                <Text style={typography.caption}>
                  {t("modal.app_settings.field.upriv_root_kept_with_default")}
                </Text>
              ) : null}
              <PathField
                value={customFieldPath}
                editable={false}
                selectTextOnFocus={!pathIsSaf}
                placeholder={t("modal.app_settings.field.upriv_root_placeholder")}
              />
              <Button
                size="sm"
                variant="ghost"
                label={t("modal.app_settings.action.choose_folder")}
                disabled={controlsDisabled || Platform.OS !== "android"}
                onPress={pickCustomFolder}
              />
              {pickError ? (
                <Text
                  style={[typography.caption, styles.errorText, { color: colors.onErrorContainer }]}
                  accessibilityRole="alert"
                >
                  {pickError}
                </Text>
              ) : null}
              {recallError ? (
                <View style={styles.errorRow}>
                  <Text
                    style={[
                      typography.caption,
                      styles.errorText,
                      { color: colors.onErrorContainer },
                    ]}
                    accessibilityRole="alert"
                  >
                    {t("modal.vault_root_setup.error_io")}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={t("action.retry")}
                    disabled={controlsDisabled}
                    onPress={retryRecall}
                  />
                </View>
              ) : null}
              {showCustomExtras && !config.upriv_root_path.trim() && Platform.OS !== "android" ? (
                <Text style={typography.caption}>{t("error.unsupported_platform")}</Text>
              ) : null}
              {showCustomExtras && diskProblemKey ? (
                <View style={styles.errorRow}>
                  <Text
                    style={[
                      typography.caption,
                      styles.errorText,
                      { color: colors.onErrorContainer },
                    ]}
                    accessibilityRole="alert"
                  >
                    {t(diskProblemKey)}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={t("action.retry")}
                    disabled={controlsDisabled}
                    onPress={retryDiskCheck}
                  />
                </View>
              ) : null}
              {showCustomExtras && visibleDisk === "needs_folder" ? (
                <Text style={typography.caption}>
                  {t("modal.vault_root_setup.error_path_required")}
                </Text>
              ) : null}
              {showCustomExtras ? incompletePanel : null}
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  options: { gap: spacing.sm },
  footerCol: { gap: spacing.sm },
  errorRow: {
    flexDirection: "column",
    gap: spacing.sm,
  },
  errorText: {},
});
