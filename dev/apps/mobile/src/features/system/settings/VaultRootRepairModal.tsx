import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  SUPPORTED_LOCALES,
  confirmNotesForReplacePolicy,
  sameVaultRootPath,
  vaultRootGateFromState,
  type IncompleteReplacePolicy,
  type LocaleId,
  type VaultRootDiskStatus,
  type VaultRootMode,
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
import { VaultRootIncompleteReplacePanel } from "./VaultRootIncompleteReplacePanel";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";

interface VaultRootRepairModalProps {
  open: boolean;
  /** Folder that contains the broken `.upriv/` (default_root anchor or custom path). */
  targetPath: string;
  /**
   * `default_root` → setupDefaultRoot + switch to default-root mode.
   * `custom_root` → setupAtPath + keep active alias at `targetPath`.
   */
  mode: VaultRootMode;
  onRepaired: () => void;
}

type PolicyChoice = IncompleteReplacePolicy | "choose_other";

type DiskApplied = {
  rootPath: string;
  source: "current" | "other";
  mode: VaultRootMode;
  /** Path that was mutated (targetPath or otherPath). */
  path: string;
  /** Policy used for that disk mutation (null = create / open without replace). */
  replacePolicy: IncompleteReplacePolicy | null;
};

/**
 * Blocking modal when a chosen vault-root has incomplete/corrupt `.upriv/`.
 *
 * Mirrors desktop `VaultRootRepairModal`: rename / delete on the current path,
 * or expand "choose another folder" with SAF-aware picker + inspect. Incomplete
 * other folders show rename/delete inside that expansion.
 */
export function VaultRootRepairModal({
  open,
  targetPath,
  mode,
  onRepaired,
}: VaultRootRepairModalProps) {
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
  const [policy, setPolicy] = useState<PolicyChoice>("rename");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherPath, setOtherPath] = useState("");
  const [otherDisk, setOtherDisk] = useState<VaultRootDiskStatus>("needs_folder");
  const [otherReplacePolicy, setOtherReplacePolicy] = useState<IncompleteReplacePolicy | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const diskApplied = useRef<DiskApplied | null>(null);
  const otherCheckGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    setPolicy("rename");
    setBusy(false);
    setPicking(false);
    setError(null);
    submitLock.current = false;
    busyGen.current += 1;
    diskApplied.current = null;
    setOtherPath("");
    setOtherDisk("needs_folder");
    setOtherReplacePolicy(null);
    setConfirmOpen(false);
  }, [open, targetPath, mode]);

  useEffect(() => {
    diskApplied.current = null;
  }, [policy, otherPath, otherReplacePolicy]);

  useEffect(() => {
    setConfirmOpen(false);
  }, [policy, otherPath, otherReplacePolicy, otherDisk]);

  useEffect(() => {
    if (!open || policy !== "choose_other") return;
    const path = otherPath.trim();
    const gen = ++otherCheckGen.current;
    if (!path) {
      setOtherDisk("needs_folder");
      return;
    }
    setOtherDisk("checking");
    void vaultRoot
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== otherCheckGen.current) return;
        if (result.status === "incomplete") setOtherDisk("incomplete");
        else if (result.status === "unreadable") setOtherDisk("unreadable");
        else if (result.status === "unauthorized") setOtherDisk("unauthorized");
        else if (result.status === "absent") setOtherDisk("will_create");
        else setOtherDisk("ready");
      })
      .catch(() => {
        if (gen !== otherCheckGen.current) return;
        setOtherDisk("unreadable");
      });
  }, [open, policy, otherPath, vaultRoot]);

  const otherGate = vaultRootGateFromState({
    dirty: true,
    disk: otherDisk,
    replacePolicy: otherReplacePolicy,
  });

  const finishWithRoot = useCallback(
    async (rootPath: string, nextMode: VaultRootMode, gen: number) => {
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: nextMode,
            upriv_root_path: nextMode === "custom_root" ? rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (gen !== busyGen.current) return;
      if (!saved) {
        throw new Error("settings_save_failed");
      }
      onRepaired();
    },
    [onRepaired, patchSettings],
  );

  const applyRepairCurrent = useCallback(
    (nextPolicy: IncompleteReplacePolicy) => {
      if (submitLock.current) return;
      const gen = ++busyGen.current;
      submitLock.current = true;
      setBusy(true);
      setError(null);

      void (async () => {
        const cached = diskApplied.current;
        if (
          cached?.source === "current" &&
          cached.mode === mode &&
          cached.replacePolicy === nextPolicy &&
          sameVaultRootPath(cached.path, targetPath)
        ) {
          if (gen !== busyGen.current) return;
          await finishWithRoot(cached.rootPath, mode, gen);
          return;
        }

        let rootPath: string;
        if (mode === "default_root") {
          const status = await vaultRoot.defaultRootStatus();
          if (gen !== busyGen.current) return;
          const anchor = status.defaultRootAnchor.trim();
          const expected = targetPath.trim();
          if (anchor && expected && anchor !== expected) {
            throw new Error(
              `default_root repair targetPath (${expected}) != setup anchor (${anchor})`,
            );
          }
          const result = await vaultRoot.setupDefaultRoot({
            replaceIncomplete: true,
            replacePolicy: nextPolicy,
            bootstrap: { locale: settings.ui.locale },
          });
          rootPath = result.rootPath;
        } else {
          const result = await vaultRoot.setupAtPath(targetPath, {
            replaceIncomplete: true,
            replacePolicy: nextPolicy,
            bootstrap: { locale: settings.ui.locale },
          });
          rootPath = result.rootPath;
        }
        if (gen !== busyGen.current) return;
        diskApplied.current = {
          rootPath,
          source: "current",
          mode,
          path: targetPath.trim(),
          replacePolicy: nextPolicy,
        };
        await finishWithRoot(rootPath, mode, gen);
      })()
        .catch((err) => {
          if (gen !== busyGen.current) return;
          setError(t(mobileErrorI18nKey(err, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          if (gen !== busyGen.current) return;
          submitLock.current = false;
          setBusy(false);
        });
    },
    [finishWithRoot, mode, settings.ui.locale, t, targetPath, vaultRoot],
  );

  const handlePickOtherFolder = useCallback(() => {
    setPicking(true);
    setError(null);
    void (async () => {
      const suggested =
        otherPath.trim() ||
        targetPath.trim() ||
        (await vaultRoot.suggestedCustomRootPath().catch(() => ""));
      const picked = await vaultRoot.pickFolder(
        suggested || null,
        t("modal.vault_root_setup.pick_folder_title"),
      );
      if (!picked?.trim()) return;
      setOtherReplacePolicy(null);
      setOtherPath(picked.trim());
    })()
      .catch((err) => {
        setError(t(mobileErrorI18nKey(err, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => setPicking(false));
  }, [otherPath, t, targetPath, vaultRoot]);

  const applyOtherFolder = useCallback(() => {
    if (submitLock.current) return;
    const path = otherPath.trim();
    if (!path) {
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }
    if (otherGate.blocksPrimary) return;

    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      const cached = diskApplied.current;
      if (
        cached?.source === "other" &&
        cached.mode === "custom_root" &&
        cached.replacePolicy === (otherReplacePolicy ?? null) &&
        sameVaultRootPath(cached.path, path)
      ) {
        if (gen !== busyGen.current) return;
        await finishWithRoot(cached.rootPath, "custom_root", gen);
        return;
      }

      const { rootPath } = await vaultRoot.setupAtPath(path, {
        replaceIncomplete: otherReplacePolicy != null,
        replacePolicy: otherReplacePolicy ?? undefined,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
      diskApplied.current = {
        rootPath,
        source: "other",
        mode: "custom_root",
        path,
        replacePolicy: otherReplacePolicy ?? null,
      };
      await finishWithRoot(rootPath, "custom_root", gen);
    })()
      .catch((err) => {
        if (gen !== busyGen.current) return;
        setError(t(mobileErrorI18nKey(err, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  }, [
    finishWithRoot,
    otherGate.blocksPrimary,
    otherPath,
    otherReplacePolicy,
    settings.ui.locale,
    t,
    vaultRoot,
  ]);

  const commitContinue = useCallback(() => {
    if (policy === "choose_other") {
      applyOtherFolder();
      return;
    }
    applyRepairCurrent(policy);
  }, [applyOtherFolder, applyRepairCurrent, policy]);

  const requestContinue = useCallback(() => {
    if (busy || picking || confirmOpen) return;
    if (policy === "choose_other" && otherGate.blocksPrimary) return;
    setConfirmOpen(true);
  }, [busy, picking, confirmOpen, otherGate.blocksPrimary, policy]);

  if (!open) return null;

  const noteKeys =
    policy === "choose_other"
      ? otherGate.confirmNotes
      : confirmNotesForReplacePolicy(policy === "delete" || policy === "rename" ? policy : null);

  const otherPathIsSaf = isAndroidSafUri(otherPath);

  const localeOptions: SelectOption<LocaleId>[] = SUPPORTED_LOCALES.map((loc) => ({
    value: loc as LocaleId,
    label: t(`modal.app_settings.option.locale.${loc}`),
  }));

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_repair.title")}
      titleIcon="refresh"
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
            label={t("modal.app_settings.field.locale")}
            title={t("modal.app_settings.field.locale")}
          />
        </View>
      }
      footer={
        <VaultRootConfirmFooter
          busy={busy}
          blocked={(policy === "choose_other" && otherGate.blocksPrimary) || picking}
          confirmOpen={confirmOpen}
          noteKeys={noteKeys}
          confirmDanger={
            policy === "delete" || (policy === "choose_other" && otherReplacePolicy === "delete")
          }
          idleStatusKey={
            policy === "choose_other" && otherDisk === "checking"
              ? "modal.vault_root_repair.checking_folder"
              : undefined
          }
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
        <Text style={typography.bodyMuted}>
          {t(
            mode === "custom_root"
              ? "modal.vault_root_repair.body_custom"
              : "modal.vault_root_repair.body",
          )}
        </Text>
        <Text
          style={[
            typography.mono,
            styles.pathBox,
            { backgroundColor: colors.surfaceContainerHighest, color: colors.onSurface },
          ]}
          selectable
        >
          {targetPath}
        </Text>

        <View
          style={styles.options}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("modal.vault_root_repair.title")}
        >
          <PolicyRadioOption
            value="rename"
            checked={policy === "rename"}
            title={t("modal.vault_root_repair.option_rename")}
            description={t("modal.vault_root_repair.rename_hint")}
            badge="default"
            onSelect={() => {
              setPolicy("rename");
              setError(null);
            }}
          />
          <PolicyRadioOption
            value="delete"
            checked={policy === "delete"}
            title={t("modal.vault_root_repair.option_delete")}
            description={t("modal.vault_root_repair.delete_hint")}
            tone="less-secure"
            onSelect={() => {
              setPolicy("delete");
              setError(null);
            }}
          />
          <PolicyRadioOption
            value="choose_other"
            checked={policy === "choose_other"}
            attention={policy === "choose_other" && otherGate.blocksPrimary}
            title={t("modal.vault_root_repair.option_choose_other")}
            description={t("modal.vault_root_repair.choose_other_hint")}
            onSelect={() => {
              setPolicy("choose_other");
              setError(null);
            }}
            footer={
              <View style={styles.chooseOtherCol}>
                <ThemedInput
                  value={otherPath}
                  editable={false}
                  placeholder={t("modal.vault_root_setup.path_placeholder")}
                  mono
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={t("modal.app_settings.action.choose_folder")}
                  disabled={busy || picking || Platform.OS !== "android"}
                  onPress={handlePickOtherFolder}
                />
                {policy === "choose_other" && Platform.OS !== "android" ? (
                  <Text style={typography.caption}>{t("error.unsupported_platform")}</Text>
                ) : null}
                {policy === "choose_other" && otherPathIsSaf ? (
                  <Text style={typography.caption}>{t("modal.vault_root_setup.saf_notice")}</Text>
                ) : null}
                {policy === "choose_other" && otherDisk === "checking" ? (
                  <Text style={typography.caption}>
                    {t("modal.app_settings.field.upriv_root_loading")}
                  </Text>
                ) : null}
                {policy === "choose_other" && otherDisk === "needs_folder" ? (
                  <Text style={typography.caption}>
                    {t("modal.vault_root_setup.error_path_required")}
                  </Text>
                ) : null}
                {policy === "choose_other" && otherDisk === "unreadable" ? (
                  <Text
                    style={[typography.caption, { color: colors.onErrorContainer }]}
                    accessibilityRole="alert"
                  >
                    {t("modal.vault_root_setup.error_io")}
                  </Text>
                ) : null}
                {policy === "choose_other" && otherDisk === "incomplete" ? (
                  <VaultRootIncompleteReplacePanel
                    context={{ kind: "custom_root", path: otherPath.trim() }}
                    replacePolicy={otherReplacePolicy}
                    onReplacePolicyChange={(next) => {
                      setOtherReplacePolicy(next);
                      setError(null);
                    }}
                    primaryAction="continue"
                  />
                ) : null}
              </View>
            }
          />
        </View>

        <Text style={typography.caption}>{t("modal.vault_root_repair.inspect_hint")}</Text>

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
  pathBox: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  options: { gap: spacing.sm },
  chooseOtherCol: { gap: spacing.sm },
  localeSelect: { minWidth: 128, maxWidth: 176 },
});
