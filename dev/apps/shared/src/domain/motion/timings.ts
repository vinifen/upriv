/** Open/close motion shared by desktop CSS and mobile `Animated`. */

export const MODAL_OPEN_MS = 220;
export const MODAL_CLOSE_MS = 160;
/** Panel scale at the start of open / end of close — keep subtle for large dialogs. */
export const MODAL_SCALE_FROM = 0.98;

/** Launch cover fade once settings and the first vault-root resolve settle. */
export const BOOT_COVER_FADE_MS = 180;
/** Shortest launch-cover time from process/page start, so a fast boot does not blink. */
export const BOOT_COVER_MIN_MS = 600;

/** Vault group body expand/collapse (chevron + height). */
export const GROUP_EXPAND_MS = 200;
export const GROUP_COLLAPSE_MS = 180;

/** File-manager dock chip tower (keep near group timings — short stack). */
export const DOCK_EXPAND_MS = 200;
export const DOCK_COLLAPSE_MS = 160;
/** Opacity fade on dock list close/open — capped under collapse so chips vanish before unmount. */
export const DOCK_FADE_MS = 140;

/** Explorer / tab-strip long-press before context menu (desktop touch) or drag (mobile). */
export const FILE_MANAGER_LONG_PRESS_MS = 450;
/** Cancel that long-press when the pointer moves this far (desktop + mobile). */
export const FILE_MANAGER_LONG_PRESS_MOVE_PX = 6;
/** Second tap within this window opens the explorer / tab menu on mobile (desktop right-click). */
export const FILE_MANAGER_DOUBLE_TAP_MS = 300;
/** Hover dwell before expanding a folder under a mobile explorer drop. */
export const FILE_MANAGER_DROP_EXPAND_MS = 400;
/** Retry OS-picker cache deletes while the file manager is mounted. */
export const FILE_MANAGER_PICKER_CACHE_WIPE_RETRY_MS = 8000;

/** Vault-list grip: pointer must move this far before a drag (and drop) starts. */
export const VAULT_LIST_DRAG_THRESHOLD_PX = 8;
