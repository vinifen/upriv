import { useCallback, useId, useMemo, useRef, useState, type UIEvent } from "react";
import { settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  buildGroupedVaultPickerItems,
  type GroupedVaultPickerItem,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";

interface GroupedVaultPickerProps {
  vaults: VaultListItem[];
  groups: VaultGroup[];
  /** When editing a group, omit that id so its vaults aren't labeled as "in another group". */
  excludeGroupId?: string;
  selectedIds: string[];
  onToggle: (vaultId: string) => void;
  disabled?: boolean;
  /** Show hidden vaults (system show-hidden). Default false. */
  includeHidden?: boolean;
  /**
   * List fills leftover modal height and is the only scroll pane.
   * Use in create-group (`bodyScroll={false}`); settings keeps a capped list.
   */
  fill?: boolean;
}

const LIST_MAX_HEIGHT = 320;
const ITEM_ROW_HEIGHT = 36;
const OVERSCAN = 8;
const VIRTUALIZE_AFTER = 48;

const checkboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent accent-accent focus:ring-2 focus:ring-accent/40";

/** Checkbox list of vaults with search and windowed rendering for large lists. */
export function GroupedVaultPicker({
  vaults,
  groups,
  excludeGroupId,
  selectedIds,
  onToggle,
  disabled = false,
  includeHidden = false,
  fill = false,
}: GroupedVaultPickerProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () =>
      buildGroupedVaultPickerItems({
        vaults,
        groups,
        excludeGroupId,
        query,
        includeHidden,
      }),
    [excludeGroupId, groups, includeHidden, query, vaults],
  );

  const useVirtual = items.length > VIRTUALIZE_AFTER;
  const totalHeight = items.length * ITEM_ROW_HEIGHT;

  const windowRange = useMemo(() => {
    if (!useVirtual) return { start: 0, end: items.length };
    const viewport = fill ? 720 : LIST_MAX_HEIGHT;
    const start = Math.max(0, Math.floor(scrollTop / ITEM_ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewport / ITEM_ROW_HEIGHT) + OVERSCAN * 2;
    return { start, end: Math.min(items.length, start + visible) };
  }, [fill, items.length, scrollTop, useVirtual]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  if (items.length === 0 && !query.trim()) {
    return (
      <p className="text-sm text-on-surface-variant">
        {t("vault.group.create.grouped_vaults_empty")}
      </p>
    );
  }

  const renderRow = (item: GroupedVaultPickerItem) => {
    const checked = selectedIds.includes(item.vault.id);
    const checkboxId = `${listId}-vault-${item.vault.id}`;
    return (
      <label
        htmlFor={checkboxId}
        className={[
          "flex h-full w-full min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5",
          "hover:bg-surface-container-high/40",
          disabled ? "pointer-events-none opacity-60" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <input
          id={checkboxId}
          type="checkbox"
          className={checkboxClass}
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(item.vault.id)}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
          {item.vault.displayName}
        </span>
        {item.otherGroup ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-on-surface-variant">
            {t("vault.group.create.in_group", { group: item.otherGroup.displayName })}
          </span>
        ) : null}
      </label>
    );
  };

  const listClass = [
    "min-h-0 overflow-y-auto [scrollbar-gutter:stable]",
    fill ? "flex-1" : "max-h-80",
  ].join(" ");

  return (
    <div className={["flex min-h-0 flex-col gap-2", fill ? "flex-1" : ""].filter(Boolean).join(" ")}>
      <input
        type="search"
        className={`${settingsControlClass} shrink-0`}
        value={query}
        disabled={disabled}
        placeholder={t("vault.group.picker.search")}
        onChange={(event) => {
          setQuery(event.target.value);
          setScrollTop(0);
          listRef.current?.scrollTo({ top: 0 });
        }}
        autoComplete="off"
        spellCheck={false}
      />

      <p className="shrink-0 text-xs text-on-surface-variant">
        {t("vault.group.picker.count", {
          selected: String(selectedIds.length),
          total: String(items.length),
        })}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-on-surface-variant">{t("vault.group.picker.search_empty")}</p>
      ) : useVirtual ? (
        <div
          ref={listRef}
          className={listClass}
          style={fill ? undefined : { maxHeight: LIST_MAX_HEIGHT }}
          onScroll={onScroll}
        >
          <div className="relative" style={{ height: totalHeight }}>
            {items.slice(windowRange.start, windowRange.end).map((item, index) => {
              const top = (windowRange.start + index) * ITEM_ROW_HEIGHT;
              return (
                <div
                  key={item.vault.id}
                  className="absolute inset-x-0"
                  style={{ top, height: ITEM_ROW_HEIGHT }}
                >
                  {renderRow(item)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div ref={listRef} className={listClass}>
          <ul className="w-full space-y-0.5">
            {items.map((item) => (
              <li key={item.vault.id} className="w-full">
                {renderRow(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
