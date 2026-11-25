import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  DATA_FOLDER_LIST_FILE,
  JOB_ERROR_CODES,
  SUPPORTED_LOCALES,
  VAULT_ROOT_ERROR_CODES,
  choiceNameLabel,
  dataFolderChangeMessage,
  isRpcError,
  jobStepCopy,
  newJobId,
  type ChoiceName,
  type FolderState,
  type FolderSwitch,
  type LocaleId,
} from "@upriv/shared";
import { hereDevice, useDataFolderList, useDeviceInfo, useToast } from "@upriv/shared/react";
import { useDeviceService, useJobService, useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Button, JobProgressBar, Modal, Select, type SelectOption } from "@/components/ui";
import { ModalFooterActions } from "@/components/ui/ModalFooterActions";
import { Toast } from "@/components/ui/Toast";
import { DataFolderListSection } from "./DataFolderListSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";
import { useDataFolderCopy } from "./useDataFolderCopy";

/** Why the Gate blocks with the data folder list. */
export type SetupScreen =
  /** Default is selected and holds no data folder: Continue makes one there. */
  | { kind: "first_run" }
  /**
   * The selected choice did not answer, at launch or once the data folder
   * in use was lost (a drive away, a grant gone): a search looks for one
   * that does.
   */
  | { kind: "selected_failed"; choice: ChoiceName; reason: FolderState }
  /** The selected folder holds a broken `.upriv/`. */
  | { kind: "repair" }
  /** The list file cannot be read. */
  | { kind: "list_invalid" };

/** The search after the selected choice did not answer. */
type Search =
  | { state: "running"; job: string; startedAt: number }
  | { state: "found_none" }
  | { state: "stopped" };

interface VaultRootSetupScreenProps {
  open: boolean;
  screen: SetupScreen | null;
  /** The vaults that ended with a lost data folder, as the resolve named them. */
  ended: readonly string[];
  /** Ask resolve again (Retry on an unreadable list). */
  onRetry: () => void;
  /**
   * A data folder is in use: the apply, or the search's switch to one that
   * answers, with the vaults that closed with a lost data folder.
   */
  onConfigured: (change: FolderSwitch | null, ended: readonly string[]) => void;
}

/**
 * The Gate's blocking screen on a phone: the data folder list, with Continue
 * opening (or making) the folder it selects in one apply. It repairs a
 * broken `.upriv/`, shows the search after the selected folder did not
 * answer, and copies a data folder kept in the private app folder into the
 * folder chosen, as a job with Stop.
 */
export function VaultRootSetupScreen({
  open,
  screen,
  ended: resolveEnded,
  onRetry,
  onConfigured,
}: VaultRootSetupScreenProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const vaultRoot = useVaultRootService();
  const jobs = useJobService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const { settings, patchSettings, adoptDataFolder } = useAppSettingsContext();
  const dataFolderCopy = useDataFolderCopy((stopError) =>
    showToast(t(mobileErrorI18nKey(stopError, "error.job_not_stoppable"))),
  );
  const kind = screen?.kind ?? null;
  const [newList, setNewList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState<Search | null>(null);
  /** The search's names of the vaults that ended, once it found none: they include the resolve's. */
  const [searchEnded, setSearchEnded] = useState<readonly string[] | null>(null);
  const ended = searchEnded ?? resolveEnded;
  const searchRef = useRef(search);
  searchRef.current = search;
  const submitLock = useRef(false);
  /** Bumped when a screen goes or a wait passes its limit: a late answer changes nothing. */
  const busyGen = useRef(0);
  const onConfiguredRef = useRef(onConfigured);
  onConfiguredRef.current = onConfigured;

  const list = useDataFolderList({
    service: vaultRoot,
    here,
    active: open && screen !== null && (kind !== "list_invalid" || newList),
    opening: true,
    primaryAction: "continue",
    newList,
    initialReplacePolicy: kind === "repair" ? "reset_settings" : null,
  });

  const stopSearch = useCallback(() => {
    const current = searchRef.current;
    if (current?.state !== "running") return;
    setSearch({ state: "stopped" });
    void jobs.cancel(current.job, "user").catch(() => undefined);
  }, [jobs]);

  // Each screen starts clean; the search runs once per failed launch.
  useEffect(() => {
    busyGen.current += 1;
    submitLock.current = false;
    setBusy(false);
    setError(null);
    setConfirmOpen(false);
    setNewList(false);
    setSearch(null);
    setSearchEnded(null);
    if (!open || kind !== "selected_failed") return;
    const gen = busyGen.current;
    const job = newJobId();
    setSearch({ state: "running", job, startedAt: Date.now() });
    vaultRoot.search(job).then(
      async (result) => {
        if (gen !== busyGen.current || searchRef.current?.state !== "running") return;
        if (!result.found) {
          setSearch({ state: "found_none" });
          setSearchEnded(result.ended);
          return;
        }
        await adoptDataFolder();
        onConfiguredRef.current(result.switch, result.ended);
      },
      (caught: unknown) => {
        if (gen !== busyGen.current) return;
        if (isRpcError(caught) && caught.code === JOB_ERROR_CODES.CANCELLED) return;
        setSearch({ state: "found_none" });
      },
    );
    return () => {
      const current = searchRef.current;
      if (current?.state === "running")
        void jobs.cancel(current.job, "user").catch(() => undefined);
    };
  }, [adoptDataFolder, jobs, kind, open, vaultRoot]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const onEdit = useCallback(() => {
    // A pick stops the search; Continue then waits only for that folder's check.
    stopSearch();
    setConfirmOpen(false);
    setError(null);
  }, [stopSearch]);

  const requestContinue = () => {
    if (busy || list.blocksPrimary || confirmOpen) return;
    setConfirmOpen(true);
  };

  const commitContinue = () => {
    if (busy || list.blocksPrimary || submitLock.current) return;
    stopSearch();
    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    const job = dataFolderCopy.begin();
    void (async () => {
      const applied = await vaultRoot.apply({
        changes: list.changes,
        newList,
        replacePolicy: list.replacePolicy ?? undefined,
        bootstrap: { locale: settings.ui.locale },
        job,
      });
      if (gen !== busyGen.current) return;
      if (applied.privateRoot === "left_behind") {
        Alert.alert(
          t("modal.vault_root_setup.title"),
          t("modal.vault_root_setup.private_root_left_behind"),
        );
      }
      await adoptDataFolder();
      onConfiguredRef.current(null, applied.ended);
    })()
      .catch((caught: unknown) => {
        if (gen !== busyGen.current) return;
        setConfirmOpen(false);
        list.retryStatuses();
        // Documents was not confirmed, or the copy was stopped: the screen stays as it was.
        if (isRpcError(caught) && caught.code === JOB_ERROR_CODES.CANCELLED) return;
        if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) return;
        setError(t(mobileErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        dataFolderCopy.end();
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  };

  if (!open || !screen) return null;

  const listShown = kind !== "list_invalid" || newList;
  const repair = kind === "repair";
  const localeOptions: SelectOption<LocaleId>[] = SUPPORTED_LOCALES.map((loc) => ({
    value: loc as LocaleId,
    label: t(`modal.app_settings.option.locale.${loc}`),
  }));

  return (
    <Modal
      open
      title={t(repair ? "modal.vault_root_repair.title" : "modal.vault_root_setup.title")}
      titleIcon={repair ? "refresh" : "folder"}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      overlay={<Toast toast={toast} onDismiss={dismissToast} />}
      headerActions={
        <View style={styles.localeSelect}>
          <Select<LocaleId>
            value={settings.ui.locale as LocaleId}
            options={localeOptions}
            onChange={handleLocaleChange}
            disabled={busy}
            size="sm"
            accessibilityLabel={t("modal.app_settings.field.locale")}
          />
        </View>
      }
      footer={
        listShown ? (
          <VaultRootConfirmFooter
            busy={busy}
            blocked={list.blocksPrimary}
            confirmOpen={confirmOpen}
            noteKeys={list.gate.confirmNotes}
            confirmDanger={list.replacePolicy === "delete"}
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
            copy={dataFolderCopy.copy}
            onStopCopy={dataFolderCopy.stop}
          />
        ) : (
          <ModalFooterActions layout="confirm">
            <Button label={t("action.retry")} variant="primary" onPress={onRetry} />
            <Button
              label={t("modal.vault_root_setup.action_new_list")}
              variant="secondary"
              onPress={() => setNewList(true)}
            />
          </ModalFooterActions>
        )
      }
    >
      <View style={styles.body}>
        <SetupBody screen={screen} newList={newList} />
        {kind === "selected_failed" && search?.state === "running" ? (
          <View style={styles.searching}>
            <JobProgressBar
              progress={null}
              startedAt={search.startedAt}
              label={t("modal.vault_root_setup.searching")}
              copy={jobStepCopy(null, "modal.vault_root_setup.searching")}
            />
          </View>
        ) : null}
        {kind === "selected_failed" && search?.state === "found_none" ? (
          <Text style={typography.bodyMuted}>{t("modal.vault_root_setup.search_found_none")}</Text>
        ) : null}
        {ended.length > 0 ? (
          <Text style={typography.bodyMuted}>{dataFolderChangeMessage(null, ended, t)}</Text>
        ) : null}
        {listShown ? (
          <DataFolderListSection
            list={list}
            here={here}
            showInUse={false}
            disabled={busy}
            onEdit={onEdit}
          />
        ) : null}
        {repair ? (
          <Text style={typography.caption}>{t("modal.vault_root_repair.inspect_hint")}</Text>
        ) : null}
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

function SetupBody({ screen, newList }: { screen: SetupScreen; newList: boolean }) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  switch (screen.kind) {
    case "first_run":
      return <Text style={typography.bodyMuted}>{t("modal.vault_root_setup.body_android")}</Text>;
    case "selected_failed":
      return (
        <Text style={typography.bodyMuted}>
          {t("modal.vault_root_setup.body_selected_failed", {
            choice: choiceNameLabel(screen.choice, t),
            reason: t(`folder_list.status.${screen.reason}`),
          })}
        </Text>
      );
    case "repair":
      return <Text style={typography.bodyMuted}>{t("modal.vault_root_repair.body")}</Text>;
    case "list_invalid":
      return newList ? null : (
        <>
          <Text style={typography.body} accessibilityRole="alert">
            {t("modal.data_folder.list_invalid")}
          </Text>
          <Text style={typography.bodyMuted}>
            {t("modal.vault_root_setup.list_invalid_hint", { file: DATA_FOLDER_LIST_FILE })}
          </Text>
        </>
      );
  }
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  searching: { gap: spacing.xs },
  localeSelect: { flexShrink: 0, maxWidth: 256 },
});
