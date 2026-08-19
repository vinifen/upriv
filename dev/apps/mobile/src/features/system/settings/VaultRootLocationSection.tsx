import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import {
  VAULT_ROOT_ALIAS_FILE,
  isVaultRootDraftDirty,
  vaultRootGateFromState,
  type AppDistribution,
  type AppSettingsConfig,
  type IncompleteReplacePolicy,
  type VaultRootDiskStatus,
  type VaultRootMode,
  type VaultRootSettingsGate,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { Button } from "@/components/ui";
import { PolicyRadioOption } from "@/components/settings/PolicyRadioOption";
import { getMobileAppVersion } from "@/lib/appVersion";
import { isAndroidSafUri } from "@/platform/native/pickVaultRootFolder";
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
    () => getMobileAppVersion().distribution,
  );

  useEffect(() => {
    setDistribution(getMobileAppVersion().distribution);
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
          else if (result.status === "unauthorized") setDisk("unauthorized");
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
        else if (result.status === "unauthorized") setDisk("unauthorized");
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

  const retryDiskCheck = useCallback(() => {
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
          else if (result.status === "unauthorized") setDisk("unauthorized");
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
        else if (result.status === "unauthorized") setDisk("unauthorized");
        else if (result.status === "absent") setDisk("will_create");
        else setDisk("ready");
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        setDisk("unreadable");
      });
  }, [config.upriv_root_path, config.vault_root_mode, vaultRootService]);

  const pickCustomFolder = useCallback(() => {
    if (controlsDisabled) return;
    setReplacePolicy(null);
    void (async () => {
      const suggested = config.upriv_root_path.trim();
      const defaultPath = suggested
        ? suggested
        : (await vaultRootService
            .readAlias()
            .then((alias) => alias?.path.trim() || "")
            .catch(() => "")) || (await vaultRootService.suggestedCustomRootPath().catch(() => ""));
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
  }, [config.upriv_root_path, controlsDisabled, onChange, t, vaultRootService]);

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
        primaryAction={primaryAction}
      />
    ) : null;

  const pathIsSaf = isAndroidSafUri(config.upriv_root_path);

  return (
    <View style={styles.wrap}>
      <Text style={typography.bodyMuted}>{t("modal.app_settings.field.upriv_root_mode")}</Text>
      <Text style={typography.caption}>{t("modal.app_settings.field.upriv_root_mode_help")}</Text>
      <View
        style={styles.options}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("modal.app_settings.field.upriv_root_mode")}
      >
        <PolicyRadioOption
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
            <View style={styles.footerCol}>
              {defaultRootAnchor ? (
                <Text
                  style={[
                    typography.mono,
                    styles.pathBox,
                    { backgroundColor: colors.surfaceContainerHighest, color: colors.onSurface },
                  ]}
                  selectable
                >
                  {defaultRootAnchor}
                </Text>
              ) : (
                <Text style={typography.caption}>
                  {t("modal.app_settings.field.upriv_root_loading")}
                </Text>
              )}
              {showDefaultRootExtras ? (
                <>
                  {disk === "checking" ? (
                    <Text style={typography.caption}>
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </Text>
                  ) : null}
                  {disk === "will_create" ? (
                    <Text style={typography.caption}>
                      {t(
                        primaryAction === "apply"
                          ? "modal.app_settings.upriv_root.switch_default_root_create_notice_apply"
                          : "modal.app_settings.upriv_root.switch_default_root_create_notice_continue",
                        { file: VAULT_ROOT_ALIAS_FILE },
                      )}
                    </Text>
                  ) : null}
                  {(disk === "unreadable" || disk === "unauthorized") ? (
                    <View style={styles.errorRow}>
                      <Text
                        style={[
                          typography.caption,
                          styles.errorText,
                          { color: colors.onErrorContainer },
                        ]}
                        accessibilityRole="alert"
                      >
                        {t(
                          disk === "unauthorized"
                            ? "modal.vault_root_setup.error_saf_unauthorized"
                            : "modal.vault_root_setup.error_io",
                        )}
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
              <View style={styles.footerCol}>
                {customRootNotice ?? (
                  <>
                    <Text style={typography.caption}>
                      {t("modal.app_settings.field.upriv_root_help")}
                    </Text>
                    {config.upriv_root_path.trim() ? (
                      <Text style={typography.caption}>
                        {t("modal.app_settings.field.upriv_root_remembered", {
                          file: VAULT_ROOT_ALIAS_FILE,
                        })}
                      </Text>
                    ) : customPathLoading || disk === "checking" ? (
                      <Text style={typography.caption}>
                        {t("modal.app_settings.field.upriv_root_loading")}
                      </Text>
                    ) : null}
                  </>
                )}
                <TextInput
                  value={config.upriv_root_path}
                  editable={false}
                  selectTextOnFocus={!pathIsSaf}
                  placeholder={t("modal.app_settings.field.upriv_root_placeholder")}
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={[
                    typography.mono,
                    styles.input,
                    {
                      backgroundColor: colors.surfaceContainerHigh,
                      borderColor: colors.outlineVariant,
                      color: colors.onSurface,
                    },
                  ]}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={t("modal.app_settings.action.choose_folder")}
                  disabled={controlsDisabled || customPathLoading}
                  onPress={pickCustomFolder}
                />
                {pathIsSaf ? (
                  <Text style={typography.caption}>{t("modal.vault_root_setup.saf_notice")}</Text>
                ) : Platform.OS !== "android" && !config.upriv_root_path.trim() ? (
                  <Text style={typography.caption}>
                    {t("modal.vault_root_setup.error_pick_unavailable")}
                  </Text>
                ) : null}
                {disk === "unreadable" || disk === "unauthorized" ? (
                  <View style={styles.errorRow}>
                    <Text
                      style={[
                        typography.caption,
                        styles.errorText,
                        { color: colors.onErrorContainer },
                      ]}
                      accessibilityRole="alert"
                    >
                      {t(
                        disk === "unauthorized"
                          ? "modal.vault_root_setup.error_saf_unauthorized"
                          : "modal.vault_root_setup.error_io",
                      )}
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
                {disk === "needs_folder" ? (
                  <Text style={typography.caption}>
                    {t("modal.vault_root_setup.error_path_required")}
                  </Text>
                ) : null}
                {incompletePanel}
              </View>
            ) : null
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
  pathBox: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  errorRow: {
    flexDirection: "column",
    gap: spacing.sm,
  },
  errorText: {},
});
