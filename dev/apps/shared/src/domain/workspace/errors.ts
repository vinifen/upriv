import type { I18nKey } from "../../i18n/catalog";
import type { WorkspacePathIssue } from "./types";

export const WORKSPACE_ERROR_CODES = {
  PATH_INVALID: "workspace_path_invalid",
  PATH_RESERVED: "workspace_path_reserved",
  UNSET: "workspace_unset",
  UNAVAILABLE: "workspace_unavailable",
} as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[keyof typeof WORKSPACE_ERROR_CODES];

const WORKSPACE_ERROR_CODE_VALUES = new Set<string>(Object.values(WORKSPACE_ERROR_CODES));

export function isWorkspaceErrorCode(code: string): code is WorkspaceErrorCode {
  return WORKSPACE_ERROR_CODE_VALUES.has(code);
}

export const WORKSPACE_PATH_ISSUE_I18N = {
  empty: "modal.workspace.error.empty",
  not_absolute: "modal.workspace.error.not_absolute",
  reserved: "modal.workspace.error.reserved",
  saf_tree_child: "modal.workspace.error.saf_tree_child",
} as const satisfies Record<WorkspacePathIssue, I18nKey>;

export function workspacePathIssueI18nKey(issue: WorkspacePathIssue): I18nKey {
  return WORKSPACE_PATH_ISSUE_I18N[issue];
}

export const WORKSPACE_ERROR_I18N = {
  [WORKSPACE_ERROR_CODES.PATH_INVALID]: "modal.workspace.error.not_absolute",
  [WORKSPACE_ERROR_CODES.PATH_RESERVED]: "modal.workspace.error.reserved",
  [WORKSPACE_ERROR_CODES.UNSET]: "modal.workspace.error.unset",
  [WORKSPACE_ERROR_CODES.UNAVAILABLE]: "modal.workspace.error.unavailable",
} as const satisfies Record<WorkspaceErrorCode, I18nKey>;

export function workspaceErrorI18nKey(code: WorkspaceErrorCode): I18nKey {
  return WORKSPACE_ERROR_I18N[code];
}
