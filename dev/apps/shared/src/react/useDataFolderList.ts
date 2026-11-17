import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DATA_FOLDER_LIST,
  dataFolderFixedFolders,
  dataFolderGate,
  isEmptyListChanges,
  listChanges,
  listDraftBlocks,
  selectionHere,
  type DataFolderChoice,
  type DataFolderGate,
  type DataFolderListView,
  type DataFolderStatus,
  type DeviceGroups,
  type DeviceId,
  type HereDevice,
  type IncompleteReplacePolicy,
  type ListChanges,
  type Selection,
  type VaultRootConfirmAction,
} from "../domain";
import type { VaultRootService } from "../services";
import { useFolderStatuses } from "./useFolderStatuses";

/** The status key of Default, which has no row path. No absolute path or URI starts with `:`. */
const DEFAULT_KEY = ":default";

export interface UseDataFolderListOptions {
  service: VaultRootService;
  here: HereDevice | null;
  /** Load while true. Turning it off drops the draft. */
  active: boolean;
  /**
   * No data folder is in use (Setup, the Gate's screens): the folder the
   * list selects is always opened, so it is always checked.
   */
  opening: boolean;
  primaryAction: VaultRootConfirmAction;
  /** Start from an empty list: the file cannot be read (Start a new list). */
  newList?: boolean;
  /** The replace choice the folder selected at load starts with (Repair). */
  initialReplacePolicy?: IncompleteReplacePolicy | null;
}

export interface DataFolderListDraft {
  /** The list as loaded; `null` until it answers. */
  view: DataFolderListView | null;
  /** Why the list could not be loaded, until a reload answers. */
  loadError: unknown;
  reload: () => void;
  saved: DeviceGroups<DataFolderChoice>;
  draft: DeviceGroups<DataFolderChoice>;
  setDraft: (groups: DeviceGroups<DataFolderChoice>) => void;
  /** Back to the list as loaded. */
  reset: () => void;
  /** What this device selects in the draft. */
  selection: Selection<DataFolderChoice>;
  /** The folder Default names here, which no row may repeat: the list marks what Apply waits for. */
  fixedHere: string[];
  /** The status of a row's folder; `null` while its check runs. */
  rowStatus: (path: string) => DataFolderStatus | null;
  /** Default's status; `null` while its check runs. */
  defaultStatus: DataFolderStatus | null;
  /** Check every folder again. */
  retryStatuses: () => void;
  replacePolicy: IncompleteReplacePolicy | null;
  setReplacePolicy: (policy: IncompleteReplacePolicy) => void;
  /** What the selected folder still needs before the primary action. */
  gate: DataFolderGate;
  /** The primary action would open a folder other than the one in use. */
  switching: boolean;
  /** The draft differs from the list as loaded. */
  dirty: boolean;
  /** What the primary action sends. */
  changes: ListChanges<DataFolderChoice>;
  /** True while the primary action waits: a step missing, or a row to fix. */
  blocksPrimary: boolean;
}

/** The folder a selection names: Default, or a row's path. */
function selectedFolderKey(
  groups: DeviceGroups<DataFolderChoice>,
  hereId: DeviceId | null,
): string {
  const selection = selectionHere(groups, hereId, DATA_FOLDER_LIST);
  if (typeof selection !== "number") return selection;
  const row = hereId
    ? groups[hereId]?.rows.find((candidate) => candidate.number === selection)
    : undefined;
  // Edits keep the selection on a row of the group; Default otherwise.
  return row ? `row:${row.path.trim()}` : "default";
}

const EMPTY: DeviceGroups<DataFolderChoice> = {};

/**
 * The data folder list as Setup, the Gate's screens, and the Data folder
 * window edit it: the list as loaded, the draft, each folder's status, the
 * replace choice for a broken `.upriv`, and the gate of the primary action.
 * The disk changes only in `data_folder_apply`, which takes `changes`.
 */
export function useDataFolderList({
  service,
  here,
  active,
  opening,
  primaryAction,
  newList = false,
  initialReplacePolicy = null,
}: UseDataFolderListOptions): DataFolderListDraft {
  const [view, setView] = useState<DataFolderListView | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [draft, setDraft] = useState<DeviceGroups<DataFolderChoice>>(EMPTY);
  const [loadRound, setLoadRound] = useState(0);
  /** A replace choice holds for the folder it was made for. */
  const [policy, setPolicy] = useState<{ key: string; policy: IncompleteReplacePolicy } | null>(
    null,
  );
  const initialPolicyRef = useRef(initialReplacePolicy);
  initialPolicyRef.current = initialReplacePolicy;
  const hereId = here?.id ?? null;
  const hereIdRef = useRef(hereId);
  hereIdRef.current = hereId;

  useEffect(() => {
    if (!active) {
      setView(null);
      setLoadError(null);
      setDraft(EMPTY);
      setPolicy(null);
      return;
    }
    let current = true;
    setLoadError(null);
    service.list({ newList }).then(
      (loaded) => {
        if (!current) return;
        setView(loaded);
        setDraft(loaded.groups);
        const initial = initialPolicyRef.current;
        setPolicy(
          initial
            ? { key: selectedFolderKey(loaded.groups, hereIdRef.current), policy: initial }
            : null,
        );
      },
      (error: unknown) => {
        if (current) setLoadError(error);
      },
    );
    return () => {
      current = false;
    };
  }, [active, loadRound, newList, service]);

  const saved = view?.groups ?? EMPTY;
  const rows = (hereId ? draft[hereId]?.rows : undefined) ?? [];
  // `useFolderStatuses` follows the paths themselves, not this array.
  const keys = view ? [DEFAULT_KEY, ...rows.map((row) => row.path)] : [];
  // A check that could not run is a folder that cannot be used now: the
  // selection's gate holds the action and offers Retry.
  const check = useCallback(
    (key: string) =>
      service
        .status(key === DEFAULT_KEY ? null : key)
        .catch((): DataFolderStatus => ({ state: "other", content: null, details: null })),
    [service],
  );
  const { statuses, retry } = useFolderStatuses(keys, check, active && view !== null);

  const selection = selectionHere(draft, hereId, DATA_FOLDER_LIST);
  const selectedKey = selectedFolderKey(draft, hereId);
  const switching =
    view !== null &&
    view.explicit === null &&
    (opening || selectedKey !== selectedFolderKey(saved, hereId));
  const selectedStatus =
    selection === "default"
      ? (statuses.get(DEFAULT_KEY) ?? null)
      : selectedKey.startsWith("row:")
        ? (statuses.get(selectedKey.slice("row:".length)) ?? null)
        : null;
  const replacePolicy = policy?.key === selectedKey ? policy.policy : null;
  const changes = useMemo(
    () => listChanges(saved, draft, hereId, DATA_FOLDER_LIST),
    [draft, hereId, saved],
  );
  const fixedHere = here ? dataFolderFixedFolders(here.system, view?.defaultFolder ?? null) : [];
  const rowsBlocked = listDraftBlocks(saved, draft, DATA_FOLDER_LIST, hereId, fixedHere);
  const gate = dataFolderGate({
    switching,
    status: selectedStatus,
    replacePolicy,
    primaryAction,
  });
  const dirty = !isEmptyListChanges(changes);

  return {
    view,
    loadError,
    reload: useCallback(() => setLoadRound((round) => round + 1), []),
    saved,
    draft,
    setDraft,
    reset: useCallback(() => setDraft(view?.groups ?? EMPTY), [view]),
    selection,
    fixedHere,
    rowStatus: (path) => statuses.get(path.trim()) ?? null,
    defaultStatus: statuses.get(DEFAULT_KEY) ?? null,
    retryStatuses: retry,
    replacePolicy,
    setReplacePolicy: (next) => setPolicy({ key: selectedKey, policy: next }),
    gate,
    switching,
    dirty,
    changes,
    blocksPrimary: view === null || rowsBlocked || gate.blocksPrimary,
  };
}
