import { useCallback, useEffect, useRef, useState } from "react";
import type { I18nKey } from "../i18n/catalog";
import type { I18nParams } from "../i18n/types";
import {
  changeKdfFormCanSubmit,
  changeKdfFormIsDirty,
  changePasswordFormCanSubmit,
  changePasswordFormIsDirty,
  changeStorageFormCanSubmit,
  changeStorageFormIsDirty,
  EMPTY_CHANGE_PASSWORD_FIELDS,
  errorDisplayI18nKey,
  errorOnPasswordField,
  formatBytes,
  passwordChangeReportLines,
  passwordChangeSpaceShort,
  storageChangeReportLines,
  unlockRamChangeReportLines,
  type ChangeKdfFieldsState,
  type ChangePasswordFieldsState,
  type ChangeStorageFieldsState,
  type KdfUnlockPreset,
  type KeyChangeReportLine,
  type VaultDisplayStatus,
  type VaultSettingsAreaId,
  type VaultStorage,
} from "../domain";
import type { ChangeVaultPasswordInput } from "../services";
import type { CoreJob } from "./useCoreJob";
import type { PasswordChangeJob, PasswordChangeOutcome } from "./usePasswordChangeJob";
import type { StorageChangeJob, StorageChangeOutcome } from "./useStorageChangeJob";
import type { UnlockRamChangeJob, UnlockRamChangeOutcome } from "./useUnlockRamChangeJob";

/** The settings screens whose change takes the vault's password and runs as a job. */
export type VaultChangeArea = "password" | "kdf" | "storage";

/**
 * The password screen changes the password, or finishes a change that left
 * files on an earlier key (a recovery row), as the vault calls for.
 */
export type PasswordScreenMode = "change" | "finish";

/** What every change screen gives its window. */
export interface VaultChangeScreen {
  area: VaultChangeArea;
  /** The form holds an edit that closing the window would lose. */
  dirty: boolean;
  /** The footer action can run. */
  canSubmit: boolean;
  /** This screen's change, while it runs for this vault. */
  job: CoreJob<{ vaultId: string }> | null;
  /** The footer action's label. */
  labelKey: I18nKey;
  /** The footer's line while the action waits for its confirmation. */
  confirmKey: I18nKey;
  /** Starts the change; a change of this kind running elsewhere is a toast. */
  submit: () => void;
  stop: () => void;
  /** Empties the form, as a discard does. */
  reset: () => void;
  /** The password the last change refused, on that field until it is edited. */
  passwordFieldError: string | null;
  /** Any other failure of the last change, until the form is edited. */
  formError: string | null;
  /** What the last change did, once it ended, while this screen shows it. */
  report: string[] | null;
}

export interface PasswordChangeScreen extends VaultChangeScreen {
  area: "password";
  mode: PasswordScreenMode;
  fields: ChangePasswordFieldsState;
  edit: (patch: Partial<ChangePasswordFieldsState>) => void;
  finishPassword: string;
  editFinishPassword: (value: string) => void;
  /** **Back up first**: on each time the window opens. */
  backUpFirst: boolean;
  setBackUpFirst: (on: boolean) => void;
}

export interface UnlockRamChangeScreen extends VaultChangeScreen {
  area: "kdf";
  /** The cost the list row read from the header; `undefined` until it is known. */
  currentPreset: KdfUnlockPreset | undefined;
  /** `null` until the screen shows. */
  fields: ChangeKdfFieldsState | null;
  edit: (patch: Partial<ChangeKdfFieldsState>) => void;
}

export interface StorageChangeScreen extends VaultChangeScreen {
  area: "storage";
  /** The copy in `config.toml`, which the screen starts from. */
  current: VaultStorage | null;
  /** `null` until the screen shows with a copy to start from. */
  fields: ChangeStorageFieldsState | null;
  edit: (patch: Partial<ChangeStorageFieldsState>) => void;
}

/** A change was made for the vault the window shows: its copy of the settings follows. */
export type VaultChangeMade =
  | { area: "password"; vaultId: string }
  | { area: "storage"; vaultId: string; storage: VaultStorage };

export interface UseVaultChangeScreensOptions {
  open: boolean;
  vaultId: string | null;
  /** The screen the window shows while it is open. */
  area: VaultSettingsAreaId | null;
  /** Every change needs the vault closed. */
  vaultListStatus: VaultDisplayStatus;
  /** The cost the list row read from the header. */
  unlockPreset: KdfUnlockPreset | undefined;
  /** The storage value's copy in `config.toml`. */
  storage: VaultStorage | null;
  /** A password change left files on an earlier key: the screen finishes it. */
  passwordChangeUnfinished: boolean;
  /** The changes in flight and how each last ended; the vault list owns them. Each start is false while another change runs. */
  passwordChange: {
    job: PasswordChangeJob | null;
    outcome: PasswordChangeOutcome | null;
    change?: (vaultId: string, input: Omit<ChangeVaultPasswordInput, "job">) => boolean;
    finish?: (vaultId: string, password: string) => boolean;
    stop?: () => void;
  };
  unlockRamChange: {
    job: UnlockRamChangeJob | null;
    outcome: UnlockRamChangeOutcome | null;
    change?: (vaultId: string, password: string, nextPreset: KdfUnlockPreset) => boolean;
    stop?: () => void;
  };
  storageChange: {
    job: StorageChangeJob | null;
    outcome: StorageChangeOutcome | null;
    change?: (vaultId: string, password: string, storage: VaultStorage) => boolean;
    stop?: () => void;
  };
  t: (key: I18nKey, params?: I18nParams) => string;
  /** The app's copy of a failure (`desktopErrorI18nKey`, `mobileErrorI18nKey`). */
  errorKey: (error: unknown) => I18nKey;
  /** A toast of the vault list. */
  notice: (message: string) => void;
  /** An edit, and a change that ends while its screen shows, close the footer's confirmation. */
  dismissConfirm: () => void;
  onChanged?: (change: VaultChangeMade) => void;
}

export interface VaultChangeScreens {
  password: PasswordChangeScreen;
  kdf: UnlockRamChangeScreen;
  storage: StorageChangeScreen;
  /** The screen the window shows, when it is a change screen. */
  active: VaultChangeScreen | null;
}

/** How the last change of a screen failed. */
interface ChangeFailure {
  vaultId: string;
  area: VaultChangeArea;
  message: string;
  onPasswordField: boolean;
}

/** What the last change of a screen did. */
interface ChangeReport {
  vaultId: string;
  area: VaultChangeArea;
  lines: string[];
}

function isChangeArea(area: VaultSettingsAreaId | null): area is VaultChangeArea {
  return area === "password" || area === "kdf" || area === "storage";
}

function jobFor<J extends { vaultId: string }>(job: J | null, vaultId: string | null): J | null {
  return job !== null && job.vaultId === vaultId ? job : null;
}

/**
 * The settings window's three change screens: Change password (and Finish),
 * Unlock RAM, and Storage. Each takes the vault's password and starts a job
 * the vault list owns, so this keeps what outlives one render: each form,
 * the last failure and report, and the form of a change that runs or failed
 * when the window closes. The window draws the fields and the footer from
 * what it returns.
 */
export function useVaultChangeScreens(options: UseVaultChangeScreensOptions): VaultChangeScreens {
  const {
    open,
    vaultId,
    vaultListStatus,
    unlockPreset,
    storage: currentStorage,
    passwordChangeUnfinished: unfinished,
  } = options;
  /** A closed window shows no screen, so each screen starts again when it opens. */
  const area = open ? options.area : null;
  const latest = useRef({ ...options, area });
  latest.current = { ...options, area };

  const [passwordFields, setPasswordFields] = useState<ChangePasswordFieldsState>(
    EMPTY_CHANGE_PASSWORD_FIELDS,
  );
  const [backUpFirst, setBackUpFirst] = useState(true);
  const [finishPassword, setFinishPassword] = useState("");
  const [kdfFields, setKdfFields] = useState<ChangeKdfFieldsState | null>(null);
  const [storageFields, setStorageFields] = useState<ChangeStorageFieldsState | null>(null);
  const [failure, setFailure] = useState<ChangeFailure | null>(null);
  const [report, setReport] = useState<ChangeReport | null>(null);
  const failureRef = useRef(failure);
  failureRef.current = failure;

  const resetPassword = useCallback(() => {
    setPasswordFields(EMPTY_CHANGE_PASSWORD_FIELDS);
    setFinishPassword("");
  }, []);
  const resetKdf = useCallback(() => setKdfFields(null), []);
  const resetStorage = useCallback(() => setStorageFields(null), []);
  const resetArea = useCallback(
    (changeArea: VaultChangeArea) => {
      if (changeArea === "password") resetPassword();
      else if (changeArea === "kdf") resetKdf();
      else resetStorage();
    },
    [resetKdf, resetPassword, resetStorage],
  );
  const resetAll = useCallback(() => {
    resetPassword();
    resetKdf();
    resetStorage();
  }, [resetKdf, resetPassword, resetStorage]);

  /** A change running, or one that failed, keeps its form: of any vault, or of `forVault`. */
  const changeHoldsForm = useCallback((forVault: string | null) => {
    const current = latest.current;
    const jobs = [
      current.passwordChange.job,
      current.unlockRamChange.job,
      current.storageChange.job,
    ];
    if (forVault === null) return jobs.some((job) => job !== null) || failureRef.current !== null;
    return (
      jobs.some((job) => job?.vaultId === forVault) || failureRef.current?.vaultId === forVault
    );
  }, []);

  useEffect(() => {
    if (open) return;
    setBackUpFirst(true);
    setReport(null);
    if (!changeHoldsForm(null)) resetAll();
  }, [open, vaultId, changeHoldsForm, resetAll]);

  useEffect(() => {
    if (!open || !vaultId) return;
    if (!changeHoldsForm(vaultId)) resetAll();
  }, [open, vaultId, changeHoldsForm, resetAll]);

  // Unlock RAM shows the header's cost and Storage the copy the list shows,
  // until an edit: then the form keeps what was chosen, and a change made
  // empties it, so it follows the vault again.
  const kdfForm: ChangeKdfFieldsState | null =
    kdfFields ?? (unlockPreset === undefined ? null : { password: "", nextPreset: unlockPreset });
  const storageForm: ChangeStorageFieldsState | null =
    storageFields ?? (currentStorage ? { password: "", storage: currentStorage } : null);

  /**
   * A change ended: the list owns it and its toast. A failure stays on its
   * screen; a change made empties its form and, while its screen shows,
   * reports what it did.
   */
  const applyOutcome = useCallback(
    (
      id: string,
      changeArea: VaultChangeArea,
      error: unknown,
      lines: KeyChangeReportLine[] | null,
    ) => {
      const current = latest.current;
      if (error !== null) {
        const space = passwordChangeSpaceShort(error);
        setFailure({
          vaultId: id,
          area: changeArea,
          message: space
            ? current.t("vault.change_password.space_short", {
                needed: formatBytes(space.needed),
                available: formatBytes(space.available),
              })
            : current.t(current.errorKey(error)),
          onPasswordField: errorOnPasswordField(errorDisplayI18nKey(error)),
        });
        return;
      }
      setFailure(null);
      if (!current.open || current.vaultId === id) resetArea(changeArea);
      if (!current.open || current.vaultId !== id || current.area !== changeArea) return;
      current.dismissConfirm();
      setReport(
        lines
          ? {
              vaultId: id,
              area: changeArea,
              lines: lines.map((line) => current.t(line.key, line.params)),
            }
          : null,
      );
    },
    [resetArea],
  );

  /** A change made for the vault the window shows updates the window's settings. */
  const reportChange = useCallback((change: VaultChangeMade) => {
    const current = latest.current;
    if (current.open && current.vaultId === change.vaultId) current.onChanged?.(change);
  }, []);

  const passwordOutcome = options.passwordChange.outcome;
  useEffect(() => {
    if (!passwordOutcome) return;
    const { vaultId: id, result, error } = passwordOutcome;
    applyOutcome(id, "password", error, passwordChangeReportLines(passwordOutcome));
    if (result) reportChange({ area: "password", vaultId: id });
  }, [passwordOutcome, applyOutcome, reportChange]);

  const unlockRamOutcome = options.unlockRamChange.outcome;
  useEffect(() => {
    if (!unlockRamOutcome) return;
    // The new cost reaches the window through the list row.
    applyOutcome(
      unlockRamOutcome.vaultId,
      "kdf",
      unlockRamOutcome.error,
      unlockRamChangeReportLines(unlockRamOutcome),
    );
  }, [unlockRamOutcome, applyOutcome]);

  const storageOutcome = options.storageChange.outcome;
  useEffect(() => {
    if (!storageOutcome) return;
    const { vaultId: id, result, error } = storageOutcome;
    applyOutcome(id, "storage", error, storageChangeReportLines(storageOutcome));
    if (result) reportChange({ area: "storage", vaultId: id, storage: result.storage });
  }, [storageOutcome, applyOutcome, reportChange]);

  /** An edit clears the screen's failure, except a refused password while that field is not the one edited. */
  const clearFailureOnEdit = (changeArea: VaultChangeArea, passwordEdited: boolean) => {
    setFailure((current) => {
      if (!current || current.vaultId !== latest.current.vaultId || current.area !== changeArea) {
        return current;
      }
      if (current.onPasswordField && !passwordEdited) return current;
      return null;
    });
    latest.current.dismissConfirm();
  };

  /** A change started: the screen drops what the last one left, and the footer its question. */
  const started = () => {
    setFailure(null);
    setReport(null);
    latest.current.dismissConfirm();
  };

  const screenState = (changeArea: VaultChangeArea) => {
    const shown =
      failure && failure.vaultId === vaultId && failure.area === changeArea ? failure : null;
    return {
      passwordFieldError: shown?.onPasswordField ? shown.message : null,
      failureMessage: shown && !shown.onPasswordField ? shown.message : null,
      report:
        report && report.vaultId === vaultId && report.area === changeArea ? report.lines : null,
    };
  };

  const passwordJob = jobFor(options.passwordChange.job, vaultId);
  const passwordState = screenState("password");
  // A running change keeps its mode while the row it changes moves on.
  const mode: PasswordScreenMode = passwordJob?.kind ?? (unfinished ? "finish" : "change");
  const finishing = mode === "finish";
  const passwordCanSubmit = finishing
    ? finishPassword.length > 0 &&
      (vaultListStatus === "closed" || vaultListStatus === "recovery") &&
      passwordJob === null
    : changePasswordFormCanSubmit({
        ...passwordFields,
        vaultListStatus,
        submitting: passwordJob !== null,
      });
  const password: PasswordChangeScreen = {
    area: "password",
    dirty: finishing ? finishPassword.length > 0 : changePasswordFormIsDirty(passwordFields),
    canSubmit: passwordCanSubmit,
    job: passwordJob,
    labelKey: finishing
      ? passwordJob
        ? "vault.change_password.finishing"
        : "vault.change_password.finish"
      : passwordJob
        ? "vault.change_password.submitting"
        : "vault.change_password.submit",
    confirmKey: finishing
      ? "modal.settings.area.password_finish_confirm"
      : "modal.settings.area.password_save_confirm",
    submit: () => {
      const current = latest.current;
      if (!vaultId || !passwordCanSubmit) return;
      const ok = finishing
        ? current.passwordChange.finish?.(vaultId, finishPassword)
        : current.passwordChange.change?.(vaultId, {
            currentPassword: passwordFields.currentPassword,
            newPassword: passwordFields.newPassword,
            backUpFirst,
            passwordHint: passwordFields.passwordHint,
          });
      if (!ok) {
        current.notice(current.t("vault.password_change.busy"));
        return;
      }
      started();
    },
    stop: () => latest.current.passwordChange.stop?.(),
    reset: resetPassword,
    passwordFieldError: passwordState.passwordFieldError,
    formError: passwordState.failureMessage,
    report: passwordState.report,
    mode,
    fields: passwordFields,
    edit: (patch) => {
      setPasswordFields((current) => ({ ...current, ...patch }));
      clearFailureOnEdit("password", patch.currentPassword !== undefined);
    },
    finishPassword,
    editFinishPassword: (value) => {
      setFinishPassword(value);
      setFailure(null);
      latest.current.dismissConfirm();
    },
    backUpFirst,
    setBackUpFirst: (on) => {
      setBackUpFirst(on);
      latest.current.dismissConfirm();
    },
  };

  const kdfJob = jobFor(options.unlockRamChange.job, vaultId);
  const kdfState = screenState("kdf");
  const kdfCanSubmit =
    kdfForm !== null &&
    unlockPreset !== undefined &&
    changeKdfFormCanSubmit({
      ...kdfForm,
      currentPreset: unlockPreset,
      vaultListStatus,
      submitting: kdfJob !== null,
    });
  const kdf: UnlockRamChangeScreen = {
    area: "kdf",
    dirty:
      kdfFields !== null &&
      unlockPreset !== undefined &&
      changeKdfFormIsDirty({ ...kdfFields, currentPreset: unlockPreset }),
    canSubmit: kdfCanSubmit,
    job: kdfJob,
    labelKey: kdfJob ? "vault.change_kdf.submitting" : "vault.change_kdf.submit",
    confirmKey: "modal.settings.area.kdf_save_confirm",
    submit: () => {
      const current = latest.current;
      if (!vaultId || !kdfForm || !kdfCanSubmit) return;
      if (!current.unlockRamChange.change?.(vaultId, kdfForm.password, kdfForm.nextPreset)) {
        current.notice(current.t("vault.unlock_ram_change.busy"));
        return;
      }
      started();
    },
    stop: () => latest.current.unlockRamChange.stop?.(),
    reset: resetKdf,
    passwordFieldError: kdfState.passwordFieldError,
    formError: kdfState.failureMessage,
    report: kdfState.report,
    currentPreset: unlockPreset,
    fields: kdfForm,
    edit: (patch) => {
      if (!kdfForm) return;
      setKdfFields((current) => ({ ...(current ?? kdfForm), ...patch }));
      clearFailureOnEdit("kdf", patch.password !== undefined);
    },
  };

  const storageJob = jobFor(options.storageChange.job, vaultId);
  const storageState = screenState("storage");
  const storageCanSubmit =
    storageForm !== null &&
    currentStorage !== null &&
    changeStorageFormCanSubmit({
      ...storageForm,
      current: currentStorage,
      vaultListStatus,
      submitting: storageJob !== null,
    });
  const storage: StorageChangeScreen = {
    area: "storage",
    dirty:
      storageFields !== null &&
      currentStorage !== null &&
      changeStorageFormIsDirty({ ...storageFields, current: currentStorage }),
    canSubmit: storageCanSubmit,
    job: storageJob,
    labelKey: storageJob ? "vault.change_storage.submitting" : "vault.change_storage.submit",
    confirmKey: "modal.settings.area.storage_save_confirm",
    submit: () => {
      const current = latest.current;
      if (!vaultId || !storageForm || !storageCanSubmit) return;
      if (!current.storageChange.change?.(vaultId, storageForm.password, storageForm.storage)) {
        current.notice(current.t("vault.change_storage.busy"));
        return;
      }
      started();
    },
    stop: () => latest.current.storageChange.stop?.(),
    reset: resetStorage,
    passwordFieldError: storageState.passwordFieldError,
    formError: storageState.failureMessage,
    report: storageState.report,
    current: currentStorage,
    fields: storageForm,
    edit: (patch) => {
      if (!storageForm) return;
      setStorageFields((current) => ({ ...(current ?? storageForm), ...patch }));
      clearFailureOnEdit("storage", patch.password !== undefined);
    },
  };

  const screens = { password, kdf, storage };
  return { ...screens, active: isChangeArea(area) ? screens[area] : null };
}
