/** Constants for configurable mount parents (not `[package].workspace_dir`). */

/**
 * Standard child directories created under `<vault-root>/.upriv/` (not a mount parent).
 * The reserved check rejects the **entire** `.upriv/` tree, not only these names.
 * Keep in sync with Rust `RESERVED_UPRIV_WORKSPACE_CHILDREN`.
 */
export const RESERVED_UPRIV_WORKSPACE_CHILDREN = ["vaults", "logs", "app", "runtime"] as const;

export type ReservedUprivWorkspaceChild = (typeof RESERVED_UPRIV_WORKSPACE_CHILDREN)[number];

/** Why a workspace / mount path was rejected (wire + UI). */
export type WorkspacePathIssue = "empty" | "not_absolute" | "reserved" | "saf_tree_child";
