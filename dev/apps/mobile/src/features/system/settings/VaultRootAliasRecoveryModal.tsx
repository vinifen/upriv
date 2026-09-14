import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  RpcError,
  isRpcError,
  sameVaultRootPath,
  type LocaleId,
  type VaultRootDiskStatus,
  type VaultRootMode,
  type VaultRootPresentationState,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { Button, Modal, Select, type SelectOption } from "@/components/ui";
import { PolicyRadioOption, ThemedInput } from "@/components/settings";
import { isAndroidSafUri } from "@/platform/native/pickVaultRootFolder";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";

interface VaultRootAliasRecoveryModalProps {
  open: boolean;
  presentation: VaultRootPresentationState;
  onRecovered: () => void;
  /** Default-root incomplete while switching to `default_root` mode — hand off to Gate repair. */
  onDefaultRootIncomplete: (defaultRootAnchor: string) => void;
  /** Custom-path incomplete — hand off to Gate repair. */
  onCustomIncomplete: (path: string) => void;
}

function isIncompleteError(error: unknown): boolean {
  if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) return true;
  if (error instanceof Error) {
    return (
      error.message === VAULT_ROOT_ERROR_CODES.INCOMPLETE ||
      error.message.startsWith(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`) ||
      error.message.includes(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`)
    );
  }
  return false;
}

/**
 * Blocking modal when custom alias / path is invalid or missing.
 * Radios + Continue (same pattern as first-run setup and Data folder).
 */
export function VaultRootAliasRecoveryModal({
  open,
  presentation,
  onRecovered,
  onDefaultRootIncomplete,
  onCustomIncomplete,
}: VaultRootAliasRecoveryModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultRoot = useVaultRootService();
  const { settings, patchSettings } = useAppSettingsContext();
  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );
  const [mode, setMode] = useState<VaultRootMode>("default_root");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [customDisk, setCustomDisk] = useState<VaultRootDiskStatus>("needs_folder");
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);
  const customCheckGen = useRef(0);
  const rememberedPath = presentation.rememberedAliasTarget ?? "";
  const [defaultRootAnchor, setDefaultRootAnchor] = useState(() =>
    presentation.defaultRootAnchor.trim(),
  );

  useEffect(() => {
    if (!open) return;
    setMode(presentation.mode === "custom_root" ? "custom_root" : "default_root");
    setPathInput(rememberedPath.trim());
    setBusy(false);
    setPicking(false);
    setError(null);
    setConfirmOpen(false);
    setCustomDisk(rememberedPath.trim() ? "checking" : "needs_folder");
    submitLock.current = false;
    busyGen.current += 1;
    diskApplied.current = null;
    setDefaultRootAnchor(presentation.defaultRootAnchor.trim());

    let cancelled = false;
    void vaultRoot
      .defaultRootStatus()
      .then((result) => {
        if (!cancelled && result.defaultRootAnchor.trim()) {
          setDefaultRootAnchor(result.defaultRootAnchor.trim());
        }
      })
      .catch(() => {
        /* keep presentation anchor if any */
      });
    return () => {
      cancelled = true;
    };
  }, [open, rememberedPath, presentation.mode, presentation.defaultRootAnchor, vaultRoot]);

  useEffect(() => {
    const applied = diskApplied.current;
    if (!applied || applied.mode !== "custom_root") return;
    if (!sameVaultRootPath(pathInput, applied.rootPath)) {
      diskApplied.current = null;
    }
  }, [pathInput]);

  useEffect(() => {
    if (!open || mode !== "custom_root") {
      setCustomDisk("ready");
      return;
    }
    const path = pathInput.trim();
    const gen = ++customCheckGen.current;
    if (!path) {
      setCustomDisk("needs_folder");
      return;
    }
    setCustomDisk("checking");
    void vaultRoot
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== customCheckGen.current) return;
        if (result.status === "incomplete") setCustomDisk("incomplete");
        else if (result.status === "unreadable") setCustomDisk("unreadable");
        else if (result.status === "unauthorized") setCustomDisk("unauthorized");
        else if (result.status === "absent") setCustomDisk("will_create");
        else setCustomDisk("ready");
      })
      .catch(() => {
        if (gen !== customCheckGen.current) return;
        setCustomDisk("unreadable");
      });
  }, [open, mode, pathInput, vaultRoot]);

  useEffect(() => {
    setConfirmOpen(false);
  }, [mode, pathInput, customDisk]);

  const handlePickFolder = useCallback(() => {
    setPicking(true);
    setError(null);
    void (async () => {
      const remembered = pathInput.trim() || rememberedPath.trim();
      const suggested = remembered || (await vaultRoot.suggestedCustomRootPath().catch(() => ""));
      const picked = await vaultRoot.pickFolder(
        suggested || null,
        t("modal.vault_root_setup.pick_folder_title"),
      );
      if (picked) setPathInput(picked);
    })()
      .catch((caught) => {
        setError(t(mobileErrorI18nKey(caught, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => setPicking(false));
  }, [pathInput, rememberedPath, t, vaultRoot]);

  const commitContinue = useCallback(() => {
    if (submitLock.current) return;
    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      if (mode === "default_root") {
        if (!diskApplied.current || diskApplied.current.mode !== "default_root") {
          const defaultRoot = await vaultRoot.defaultRootStatus();
          if (gen !== busyGen.current) return;
          if (defaultRoot.status === "incomplete") {
            onDefaultRootIncomplete(defaultRoot.defaultRootAnchor);
            return;
          }
          if (defaultRoot.status === "unreadable") {
            throw new RpcError(
              VAULT_ROOT_ERROR_CODES.IO_ERROR,
              "default_root .upriv is unreadable",
            );
          }
          try {
            const { rootPath } = await vaultRoot.setupDefaultRoot({
              bootstrap: { locale: settings.ui.locale },
            });
            if (gen !== busyGen.current) return;
            diskApplied.current = { rootPath, mode: "default_root" };
          } catch (caught) {
            if (gen !== busyGen.current) return;
            if (isIncompleteError(caught)) {
              onDefaultRootIncomplete(defaultRoot.defaultRootAnchor);
              return;
            }
            throw caught;
          }
        }
        if (gen !== busyGen.current) return;
        const saved = await patchSettings(
          {
            app: {
              vault_root_mode: "default_root",
              upriv_root_path: "",
            },
          },
          { vaultRootAlreadyApplied: true },
        );
        if (gen !== busyGen.current) return;
        if (!saved) throw new Error("settings_save_failed");
        onRecovered();
        return;
      }

      const path = pathInput.trim();
      const applied = diskApplied.current;
      const canReuseCustom =
        applied?.mode === "custom_root" && path && sameVaultRootPath(applied.rootPath, path);

      if (!path && !canReuseCustom) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }

      if (!canReuseCustom) {
        diskApplied.current = null;
        try {
          const inspected = await vaultRoot.inspectAtPath(path);
          if (gen !== busyGen.current) return;
          if (inspected.status === "incomplete") {
            onCustomIncomplete(path);
            return;
          }
        } catch (caught) {
          if (gen !== busyGen.current) return;
          if (isIncompleteError(caught)) {
            onCustomIncomplete(path);
            return;
          }
        }
        try {
          const { rootPath } = await vaultRoot.setupAtPath(path, {
            bootstrap: { locale: settings.ui.locale },
          });
          if (gen !== busyGen.current) return;
          diskApplied.current = { rootPath, mode: "custom_root" };
          const saved = await patchSettings(
            {
              app: {
                vault_root_mode: "custom_root",
                upriv_root_path: rootPath,
              },
            },
            { vaultRootAlreadyApplied: true },
          );
          if (gen !== busyGen.current) return;
          if (!saved) throw new Error("settings_save_failed");
          onRecovered();
          return;
        } catch (caught) {
          if (gen !== busyGen.current) return;
          if (isIncompleteError(caught)) {
            onCustomIncomplete(path);
            return;
          }
          throw caught;
        }
      }

      const reused = diskApplied.current!;
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: reused.mode,
            upriv_root_path: reused.mode === "custom_root" ? reused.rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (gen !== busyGen.current) return;
      if (!saved) throw new Error("settings_save_failed");
      onRecovered();
    })()
      .catch((caught) => {
        if (gen !== busyGen.current) return;
        setError(t(mobileErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  }, [
    mode,
    onCustomIncomplete,
    onDefaultRootIncomplete,
    onRecovered,
    patchSettings,
    pathInput,
    settings.ui.locale,
    t,
    vaultRoot,
  ]);

  const blocked =
    picking ||
    (mode === "custom_root" && !pathInput.trim()) ||
    (mode === "custom_root" &&
      (customDisk === "checking" || customDisk === "unreadable" || customDisk === "needs_folder"));

  const requestContinue = useCallback(() => {
    if (busy || blocked || confirmOpen) return;
    setConfirmOpen(true);
  }, [blocked, busy, confirmOpen]);

  if (!open) return null;

  const pathIsSaf = isAndroidSafUri(pathInput);

  const localeOptions: SelectOption<LocaleId>[] = SUPPORTED_LOCALES.map((loc) => ({
    value: loc as LocaleId,
    label: t(`modal.app_settings.option.locale.${loc}`),
  }));

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_setup.title")}
      titleIcon="folder"
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      headerActions={
        <View style={styles.localeSelect}>
          <Select<LocaleId>
            value={settings.ui.locale as LocaleId}
            options={localeOptions}
            onChange={handleLocaleChange}
            disabled={busy || picking}
            size="sm"
            accessibilityLabel={t("modal.app_settings.field.locale")}
          />
        </View>
      }
      footer={
        <VaultRootConfirmFooter
          busy={busy}
          blocked={blocked}
          confirmOpen={confirmOpen}
          noteKeys={undefined}
          onRequestPrimary={requestContinue}
          onConfirmPrimary={commitContinue}
          onCancelConfirm={() => setConfirmOpen(false)}
          onBusyTimeout={() => {
            busyGen.current += 1;
            submitLock.current = false;
            setBusy(false);
            setConfirmOpen(false);
            setError(t("loading.timed_out"));
          }}
        />
      }
    >
      <View style={styles.body}>
        <Text
          style={[typography.body, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {t("modal.vault_root_setup.error_alias_invalid")}
        </Text>
        {rememberedPath.trim() ? (
          <Text style={[typography.mono, styles.remembered]} selectable>
            {t("modal.vault_root_setup.alias_invalid_path", {
              path: rememberedPath.trim(),
              file: VAULT_ROOT_ALIAS_FILE,
            })}
          </Text>
        ) : null}
        <View
          style={styles.options}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("modal.app_settings.field.upriv_root_mode")}
        >
          <PolicyRadioOption
            value="default_root"
            checked={mode === "default_root"}
            title={t("modal.app_settings.option.upriv_root.default_root")}
            description={t("modal.vault_root_setup.recovery_default_root_desc")}
            badge="default"
            onSelect={() => {
              setMode("default_root");
              setError(null);
            }}
            footer={
              defaultRootAnchor ? (
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
              )
            }
          />
          <PolicyRadioOption
            value="custom_root"
            checked={mode === "custom_root"}
            title={t("modal.app_settings.option.upriv_root.custom_root")}
            description={t("modal.app_settings.option.upriv_root.custom_root_desc", {
              file: VAULT_ROOT_ALIAS_FILE,
            })}
            onSelect={() => {
              setMode("custom_root");
              setError(null);
              if (!pathInput.trim() && rememberedPath.trim()) {
                setPathInput(rememberedPath.trim());
              }
            }}
            footer={
              <View style={styles.customCol}>
                <ThemedInput
                  value={pathInput}
                  editable={false}
                  placeholder={t("modal.vault_root_setup.path_placeholder")}
                  mono
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={t("modal.app_settings.action.choose_folder")}
                  disabled={busy || picking || Platform.OS !== "android"}
                  onPress={handlePickFolder}
                />
                {mode === "custom_root" && Platform.OS !== "android" ? (
                  <Text style={typography.caption}>{t("error.unsupported_platform")}</Text>
                ) : null}
                {mode === "custom_root" && pathIsSaf ? (
                  <Text style={typography.caption}>{t("modal.vault_root_setup.saf_notice")}</Text>
                ) : null}
                {mode === "custom_root" && customDisk === "checking" ? (
                  <Text style={typography.caption}>
                    {t("modal.app_settings.field.upriv_root_loading")}
                  </Text>
                ) : null}
                {mode === "custom_root" && customDisk === "will_create" ? (
                  <Text style={typography.caption}>
                    {t("modal.vault_root_gate.continue_confirm_note.create")}
                  </Text>
                ) : null}
                {mode === "custom_root" && customDisk === "incomplete" ? (
                  <Text style={typography.caption}>
                    {t("modal.app_settings.continue_confirm_custom_incomplete", {
                      path: pathInput.trim() || "…",
                    })}
                  </Text>
                ) : null}
                {mode === "custom_root" && customDisk === "unreadable" ? (
                  <Text
                    style={[typography.caption, { color: colors.onErrorContainer }]}
                    accessibilityRole="alert"
                  >
                    {t("modal.vault_root_setup.error_io")}
                  </Text>
                ) : null}
              </View>
            }
          />
        </View>
        {error ? (
          <Text
            style={[typography.body, { color: colors.onErrorContainer }]}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  remembered: {
    paddingHorizontal: spacing.xs,
  },
  options: { gap: spacing.sm },
  customCol: { gap: spacing.sm },
  pathBox: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  localeSelect: { flexShrink: 0, maxWidth: 256 },
});
