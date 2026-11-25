import { useCallback, useEffect, useId, useState } from "react";
import { Button, Modal, Toast } from "@/components/ui";
import { PathField } from "@/components/PathField";
import { StatusLine, problemKey } from "@/components/folder-list";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import { hereDevice, useDeviceInfo, useFolderStatuses } from "@upriv/shared/react";
import { useDeviceService, useFolderListService, useVaultRootService } from "@/platform/services";
import {
  besideFolder,
  folderStatusLine,
  plainPlaceProblem,
  type AppUnlockedChoice,
  type DeviceGroups,
  type PlainPlaceChoice,
  type RowProblem,
  type StatusLine as StatusLineValue,
  type VaultUnlockedChoice,
} from "@upriv/shared";

interface PlainPlaceModalProps {
  open: boolean;
  vaultName: string;
  /** The app's unlocked folders can change only while no vault is open. */
  appChoices: boolean;
  /** The app's unlocked folders, which a folder typed for the app's list may not repeat. */
  appUnlocked: DeviceGroups<AppUnlockedChoice>;
  /** The vault's own unlocked folders; `null` while they load. */
  vaultUnlocked: DeviceGroups<VaultUnlockedChoice> | null;
  submitting: boolean;
  onClose: () => void;
  onContinue: (choice: PlainPlaceChoice, path: string) => void;
}

/**
 * "Where should the files go?" before the password, when this device has
 * no unlocked folder chosen for a plain-text vault: Beside the data folder,
 * a folder added to the app's list, or one added to this vault's own list.
 * A typed or picked folder is checked as it changes, by the rules of the row
 * it becomes and then on the disk once it settles; Continue waits until it
 * passes, then saves it as that list's choice on this device. The unlock
 * window that follows names the folder, and warns when its drive is
 * removable, network, or cloud.
 */
export function PlainPlaceModal({
  open,
  vaultName,
  appChoices,
  appUnlocked,
  vaultUnlocked,
  submitting,
  onClose,
  onContinue,
}: PlainPlaceModalProps) {
  const { t } = useTranslation();
  const { toast, showError, dismiss } = useErrorToast();
  const vaultRootService = useVaultRootService();
  const folderLists = useFolderListService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const group = useId();
  const [choice, setChoice] = useState<PlainPlaceChoice | null>(null);
  /** The data folder in use: `undefined` while it is being worked out, `null` when there is none. */
  const [dataFolder, setDataFolder] = useState<string | null | undefined>(undefined);
  const [appPath, setAppPath] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const system = here?.system ?? null;

  useEffect(() => {
    if (open) return;
    setChoice(null);
    setDataFolder(undefined);
    setAppPath("");
    setVaultPath("");
  }, [open]);

  // The first option starts chosen. With the app's folders locked, only this
  // vault's own list is left.
  useEffect(() => {
    if (!open) return;
    setChoice((current) => (appChoices ? (current ?? "beside") : "vault_folder"));
  }, [open, appChoices]);

  useEffect(() => {
    if (!open || !system) return;
    let cancelled = false;
    void vaultRootService.resolve().then(
      (resolved) => {
        if (!cancelled) setDataFolder(resolved.status === "found" ? resolved.rootPath : null);
      },
      () => {
        if (!cancelled) setDataFolder(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, system, vaultRootService]);

  /** `null` while the folder beside the data folder is still being worked out. */
  const besidePath =
    dataFolder === undefined || !system ? null : dataFolder ? besideFolder(system, dataFolder) : "";

  /**
   * What the row a folder choice adds gets wrong, at once and with no disk
   * access; `undefined` while what it is checked against still loads.
   */
  const ruleProblem = (
    folderChoice: "app_folder" | "vault_folder",
    path: string,
  ): RowProblem | null | undefined => {
    if (!path.trim()) return "empty";
    const loading = folderChoice === "app_folder" ? dataFolder === undefined : !vaultUnlocked;
    if (!here || loading) return undefined;
    return plainPlaceProblem({
      choice: folderChoice,
      path,
      here,
      appUnlocked,
      vaultUnlocked: vaultUnlocked ?? {},
      dataFolder: dataFolder ?? null,
    });
  };
  const appRule = ruleProblem("app_folder", appPath);
  const vaultRule = ruleProblem("vault_folder", vaultPath);

  // A folder the rules let through is checked on the disk once its path
  // settles, as a list row is.
  const checkStatus = useCallback(
    (path: string) => folderLists.status("unlocked", path, null),
    [folderLists],
  );
  const { statuses } = useFolderStatuses(
    [appRule === null ? appPath : "", vaultRule === null ? vaultPath : ""],
    checkStatus,
    open,
  );

  const folderCheck = (rule: RowProblem | null | undefined, path: string): PlaceFolderCheck => {
    if (rule === "empty") return { holds: true, attention: true, line: null };
    if (rule) return { holds: true, attention: true, line: problemLine(t(problemKey(rule))) };
    // A check that could not run says nothing; Continue lets core decide.
    if (rule === null && !statuses.has(path.trim())) {
      return { holds: false, attention: false, line: null };
    }
    const status = rule === undefined ? null : (statuses.get(path.trim()) ?? null);
    if (!status)
      return { holds: true, attention: false, line: folderStatusLine(null, "unlocked", t) };
    // A plain-text vault writes ordinary files: an encrypted vault's folder
    // limit of the file system does not apply.
    const plain = status.details
      ? { ...status, details: { ...status.details, noEncryptedFolder: false } }
      : status;
    const failing = status.state !== "ok";
    return { holds: failing, attention: failing, line: folderStatusLine(plain, "unlocked", t) };
  };
  const appCheck = folderCheck(appRule, appPath);
  const vaultCheck = folderCheck(vaultRule, vaultPath);

  // A chosen option that still lacks its folder, or whose folder fails,
  // carries the attention border and holds Continue; choosing it opens nothing.
  const besideMissing = besidePath !== null && besidePath.trim() === "";
  const canContinue =
    (appChoices && choice === "beside" && Boolean(besidePath?.trim())) ||
    (appChoices && choice === "app_folder" && !appCheck.holds) ||
    (choice === "vault_folder" && !vaultCheck.holds);

  const pickInto = (apply: (path: string) => void, current: string) => {
    void (async () => {
      try {
        const picked = await vaultRootService.pickFolder(
          current.trim() || null,
          t("folder_list.action.browse"),
        );
        if (picked?.trim()) apply(picked.trim());
      } catch (error) {
        showError(error, "error.unexpected");
      }
    })();
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
            <Button
              variant="primary"
              size="sm"
              disabled={submitting || !canContinue || !choice}
              onClick={() => {
                if (!choice || !canContinue) return;
                const path =
                  choice === "app_folder" ? appPath : choice === "vault_folder" ? vaultPath : "";
                onContinue(choice, path.trim());
              }}
            >
              {t("action.continue")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">{t("plain.place.body")}</p>
          <div role="radiogroup" aria-label={t("plain.place.title")} className="grid gap-2">
            {!appChoices ? (
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t("plain.place.app_locked")}
              </p>
            ) : null}
            <PolicyRadioOption
              groupName={group}
              value="beside"
              checked={choice === "beside"}
              attention={besideMissing}
              title={t("plain.place.beside")}
              badge="default"
              description={t("plain.place.beside_desc")}
              disabled={submitting || !appChoices}
              onSelect={() => setChoice("beside")}
              footer={<PathField value={besidePath ?? ""} readOnly />}
            />
            <PolicyRadioOption
              groupName={group}
              value="app_folder"
              checked={choice === "app_folder"}
              attention={appCheck.attention}
              title={t("plain.place.app_folder")}
              description={t("plain.place.app_folder_desc")}
              disabled={submitting || !appChoices}
              onSelect={() => setChoice("app_folder")}
              footer={
                <PlacePathEditor
                  value={appPath}
                  line={appCheck.line}
                  disabled={submitting}
                  onChange={setAppPath}
                  onPick={() => pickInto(setAppPath, appPath)}
                />
              }
            />
            <PolicyRadioOption
              groupName={group}
              value="vault_folder"
              checked={choice === "vault_folder"}
              attention={vaultCheck.attention}
              title={t("plain.place.vault_folder")}
              description={t("plain.place.vault_folder_desc")}
              disabled={submitting}
              onSelect={() => setChoice("vault_folder")}
              footer={
                <PlacePathEditor
                  value={vaultPath}
                  line={vaultCheck.line}
                  disabled={submitting}
                  onChange={setVaultPath}
                  onPick={() => pickInto(setVaultPath, vaultPath)}
                />
              }
            />
          </div>
        </div>
      </Modal>
      <Toast toast={toast} onDismiss={dismiss} className="z-[160]" />
    </>
  );
}

/** Where a folder typed or picked for a folder choice stands. */
interface PlaceFolderCheck {
  /** Continue waits: the folder is missing, refused, failing, or still being checked. */
  holds: boolean;
  /** The yellow border: missing, refused, or failing, never while a check runs. */
  attention: boolean;
  /** Under the field: why it is refused, or what the folder's check found. */
  line: StatusLineValue | null;
}

function problemLine(text: string): StatusLineValue {
  return { tone: "problem", text };
}

function PlacePathEditor({
  value,
  line,
  disabled,
  onChange,
  onPick,
}: {
  value: string;
  line: StatusLineValue | null;
  disabled: boolean;
  onChange: (path: string) => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <PathField
          className="sm:flex-1"
          value={value}
          disabled={disabled}
          placeholder={t("modal.folder_field.placeholder")}
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
          {t("folder_list.action.browse")}
        </Button>
      </div>
      {line ? <StatusLine line={line} /> : null}
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
