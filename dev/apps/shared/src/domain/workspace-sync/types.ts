/** Result of reconciling the in-memory workspace mirror with disk. */
export interface WorkspaceReconcileResult {
  revision: number;
  /** Absolute paths (`/foo.txt`) with unsaved in-app edits that diverged from disk. */
  conflicts: string[];
}
