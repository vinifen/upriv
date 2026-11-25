import { useCallback, useEffect, useRef, useState } from "react";
import { Button, JobProgressBar, Modal, Select } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
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
  type AppDistribution,
  type ChoiceName,
  type FolderState,
  type FolderSwitch,
  type LocaleId,
} from "@upriv/shared";
import { hereDevice, useDataFolderList, useDeviceInfo } from "@upriv/shared/react";
import { useDeviceService, useJobService, useVaultRootService } from "@/platform/services";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useAppSettingsContext } from "./AppSettingsContext";
import { DataFolderListSection } from "./DataFolderListSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";

/** Why the Gate blocks with the data folder list. */
export type SetupScreen =
  /** Default is selected and holds no data folder: Continue makes one there. */
  | { kind: "first_run"; distribution: AppDistribution }
  /**
   * The selected choice did not answer, at launch or once the data folder
   * in use was lost: a search looks for one that does.
   */
  | { kind: "selected_failed"; choice: ChoiceName; reason: FolderState }
  /** The selected folder holds a broken `.upriv/`. */
  | { kind: "repair" }
  /** The list file cannot be read. */
  | { kind: "list_invalid" };

const FIRST_RUN_BODY: Record<AppDistribution, I18nKey> = {
  portable: "modal.vault_root_setup.body_portable",
  installed: "modal.vault_root_setup.body_installed",
  dev: "modal.vault_root_setup.body_dev",
};

/** The search after the selected choice did not answer. */
type Search =
  | { state: "running"; job: string; startedAt: number }
  | { state: "found_none" }
  | { state: "stopped" };

interface VaultRootSetupModalProps {
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
 * The Gate's blocking screen: the data folder list, with Continue opening
 * (or making) the folder it selects in one `data_folder_apply`. The same
 * screen repairs a broken `.upriv/` and, after the selected folder did not
 * answer, shows the search for one that does.
 */
export function VaultRootSetupModal({
  open,
  screen,
  ended: resolveEnded,
  onRetry,
  onConfigured,
}: VaultRootSetupModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const jobs = useJobService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const { settings, patchSettings, adoptDataFolder } = useAppSettingsContext();
  const kind = screen?.kind ?? null;
  /** Start a new list was chosen on an unreadable list. */
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
    void (async () => {
      const applied = await vaultRoot.apply({
        changes: list.changes,
        newList,
        replacePolicy: list.replacePolicy ?? undefined,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
      await adoptDataFolder();
      onConfiguredRef.current(null, applied.ended);
    })()
      .catch((caught: unknown) => {
        if (gen !== busyGen.current) return;
        setConfirmOpen(false);
        if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          // The folder broke since its check: check again, and its replace choice shows.
          list.retryStatuses();
          return;
        }
        list.retryStatuses();
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  };

  const listShown = kind !== "list_invalid" || newList;
  const repair = kind === "repair";

  return (
    <Modal
      open={open && screen !== null}
      title={t(repair ? "modal.vault_root_repair.title" : "modal.vault_root_setup.title")}
      titleIcon={repair ? "refresh" : "folder"}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      rootClassName="z-[200]"
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
          />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
            <Button variant="primary" size="md" onClick={onRetry}>
              {t("action.retry")}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setNewList(true)}>
              {t("modal.vault_root_setup.action_new_list")}
            </Button>
          </div>
        )
      }
      headerActions={
        <label className="flex items-center gap-1.5">
          <span className="sr-only">{t("modal.app_settings.field.locale")}</span>
          <Select
            size="sm"
            value={settings.ui.locale}
            disabled={busy}
            aria-label={t("modal.app_settings.field.locale")}
            onChange={(locale) => handleLocaleChange(locale as LocaleId)}
            options={SUPPORTED_LOCALES.map((locale) => ({
              value: locale,
              label: t(`modal.app_settings.option.locale.${locale}`),
            }))}
          />
        </label>
      }
    >
      <div
        className="space-y-3 text-sm leading-relaxed text-on-surface-variant"
        onPointerDown={() => {
          if (confirmOpen) setConfirmOpen(false);
        }}
      >
        {screen ? <SetupBody screen={screen} newList={newList} /> : null}
        {kind === "selected_failed" && search?.state === "running" ? (
          <JobProgressBar
            progress={null}
            startedAt={search.startedAt}
            label={t("modal.vault_root_setup.searching")}
            copy={jobStepCopy(null, "modal.vault_root_setup.searching")}
          />
        ) : null}
        {kind === "selected_failed" && search?.state === "found_none" ? (
          <p role="status">{t("modal.vault_root_setup.search_found_none")}</p>
        ) : null}
        {ended.length > 0 ? <p role="status">{dataFolderChangeMessage(null, ended, t)}</p> : null}
        {listShown ? (
          <DataFolderListSection
            list={list}
            here={here}
            showInUse={false}
            disabled={busy}
            onEdit={onEdit}
          />
        ) : null}
        {repair ? <p className="text-xs">{t("modal.vault_root_repair.inspect_hint")}</p> : null}
        {error ? (
          <p
            className="rounded-md bg-error-container/10 px-3 py-2 text-sm text-on-error-container"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t("modal.vault_root_setup.busy")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SetupBody({ screen, newList }: { screen: SetupScreen; newList: boolean }) {
  const { t } = useTranslation();
  switch (screen.kind) {
    case "first_run":
      return <p>{t(FIRST_RUN_BODY[screen.distribution])}</p>;
    case "selected_failed":
      return (
        <p>
          {t("modal.vault_root_setup.body_selected_failed", {
            choice: choiceNameLabel(screen.choice, t),
            reason: t(`folder_list.status.${screen.reason}`),
          })}
        </p>
      );
    case "repair":
      return <p>{t("modal.vault_root_repair.body")}</p>;
    case "list_invalid":
      return newList ? null : (
        <>
          <p role="alert">{t("modal.data_folder.list_invalid")}</p>
          <p>{t("modal.vault_root_setup.list_invalid_hint", { file: DATA_FOLDER_LIST_FILE })}</p>
        </>
      );
  }
}
