import {
  canReorderGroupedVaults,
  draggingGroupedVaultSourceGroupId as resolveDraggingGroupedVaultSourceGroupId,
  groupedVaultDragKey,
  groupedVaultSortOf,
  listDropHighlight,
  LIST_ROOT_UNGROUP_DRAG_KEY,
  listUngroupDragKey,
  parseGroupedVaultDragKey,
  resolveListDrop,
  rootRowDragKey,
  vaultBlocksColumnCount,
  vaultBlocksGroupColumnSpan,
  vaultBlocksGroupInnerColumns,
  type VaultListItem,
  type VaultListRootRow,
  type VaultListViewMode,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { vaultListDropOverClass } from "../lib/dropOverClass";
import { vaultListDropKeyProps } from "../lib/listDropKey";
import { VaultBlockCard } from "./VaultBlockCard";
import { VaultGroupRow } from "./VaultGroupRow";
import { VaultListEmptyState } from "./VaultListEmptyState";
import { VaultRow } from "./VaultRow";
import type { VaultListPointerDragHandlers } from "./vaultListPointerDrag";

function UngroupDropZone({
  className = "",
  dropKey,
  dragOverId,
  label,
}: {
  className?: string;
  dropKey: string;
  dragOverId: string | null;
  label: string;
}) {
  const active = dragOverId === dropKey;
  return (
    <div
      role="status"
      {...vaultListDropKeyProps(dropKey)}
      className={[
        "rounded-xl border-2 border-dashed px-3 py-5 min-h-14 w-full flex items-center justify-center text-center text-sm",
        active
          ? "vault-list-ungroup-drop-active text-on-surface"
          : "border-outline-variant text-on-surface-variant",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </div>
  );
}

function blocksGridClass(columns: 1 | 2 | 3): string {
  if (columns === 3) return "grid min-w-0 grid-cols-3 gap-4";
  if (columns === 2) return "grid min-w-0 grid-cols-2 gap-3 sm:gap-4";
  return "grid min-w-0 grid-cols-1 gap-3";
}

function blocksGroupInnerClass(innerColumns: 1 | 2 | 3): string {
  const pad = "min-w-0 px-1.5 pb-2 pt-0 sm:px-2";
  if (innerColumns <= 1) return `grid min-w-0 grid-cols-1 gap-3 ${pad}`;
  if (innerColumns === 2) return `grid min-w-0 grid-cols-2 gap-3 sm:gap-4 ${pad}`;
  return `grid min-w-0 grid-cols-3 gap-4 ${pad}`;
}

export interface VaultPipelineListStatus {
  openingVaultIds?: readonly string[];
  closingVaultIds?: readonly string[];
}

interface VaultListProps {
  rows: VaultListRootRow[];
  pipelineListStatus?: VaultPipelineListStatus;
  isVaultPipelineBusy?: (vaultId: string) => boolean;
  allVaultsHidden?: boolean;
  searchNoMatches?: boolean;
  viewMode: VaultListViewMode;
  canReorder: boolean;
  vaultListShowDrag?: boolean;
  vaultListAllowDragIntoGroup?: boolean;
  draggingId: string | null;
  dragOverId: string | null;
  dragPointer: { x: number; y: number } | null;
  pointerDrag: VaultListPointerDragHandlers;
  onCreateFromScratch: () => void;
  onImportPackage: () => void;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenVaultInfo: (vaultId: string) => void;
  onOpenSettings: (vaultId: string, area: VaultSettingsAreaId) => void;
  onOpenGroupSettings: (groupId: string) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
}

export function VaultList({
  rows,
  pipelineListStatus = {},
  isVaultPipelineBusy = () => false,
  allVaultsHidden = false,
  searchNoMatches = false,
  viewMode,
  canReorder,
  vaultListShowDrag = true,
  vaultListAllowDragIntoGroup = true,
  draggingId,
  dragOverId,
  dragPointer,
  pointerDrag,
  onCreateFromScratch,
  onImportPackage,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onOpenGroupSettings,
  onToggleGroupCollapsed,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
}: VaultListProps) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(900);
  const blockColumns = vaultBlocksColumnCount(gridWidth);

  useLayoutEffect(() => {
    if (viewMode !== "blocks") return;
    const el = gridRef.current;
    if (!el) return;
    const apply = () => {
      const next = el.getBoundingClientRect().width;
      if (next > 0) setGridWidth(next);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, rows.length]);

  const draggingGroupedVaultSourceGroupId = resolveDraggingGroupedVaultSourceGroupId(
    draggingId,
    vaultListAllowDragIntoGroup,
  );

  const dropResolution = useMemo(() => {
    if (!draggingId || !dragOverId) return { kind: "noop" as const };
    return resolveListDrop({
      sourceKey: draggingId,
      targetKey: dragOverId,
      canReorderRoot: canReorder,
      allowDragIntoGroup: vaultListAllowDragIntoGroup,
      canReorderGrouped: (groupId) => {
        const row = rows.find((r) => r.kind === "group" && r.group.id === groupId);
        return Boolean(
          row &&
          row.kind === "group" &&
          vaultListShowDrag &&
          canReorderGroupedVaults(groupedVaultSortOf(row.group)),
        );
      },
    });
  }, [canReorder, dragOverId, draggingId, rows, vaultListAllowDragIntoGroup, vaultListShowDrag]);
  const dropHighlight = listDropHighlight(dropResolution.kind);
  const dropOverBlocked = dropHighlight === "blocked";
  const isDropOver = (key: string) =>
    dragOverId === key && draggingId !== key && dropHighlight !== "none";

  const reorderHandleLabel = t("action.drag_reorder");
  const groupHandleLabel = t("action.drag_to_group");

  const dragChipLabel = useMemo(() => {
    if (!draggingId) return "";
    if (draggingId.startsWith("group:")) {
      const id = draggingId.slice("group:".length);
      for (const row of rows) {
        if (row.kind === "group" && row.group.id === id) return row.group.displayName;
      }
      return "";
    }
    const vaultId =
      parseGroupedVaultDragKey(draggingId)?.vaultId ??
      (draggingId.startsWith("vault:") ? draggingId.slice("vault:".length) : null);
    if (!vaultId) return "";
    for (const row of rows) {
      if (row.kind === "vault" && row.vault.id === vaultId) return row.vault.displayName;
      if (row.kind === "group") {
        const member = row.groupedVaults.find((vault) => vault.id === vaultId);
        if (member) return member.displayName;
      }
    }
    return "";
  }, [draggingId, rows]);

  const renderGroupUngroupDrop = (groupId: string, className = "") => {
    const dropKey = listUngroupDragKey(groupId);
    return (
      <UngroupDropZone
        className={className}
        dropKey={dropKey}
        dragOverId={dragOverId}
        label={t("vault.group.drop_to_ungroup")}
      />
    );
  };

  const dragChip =
    draggingId && dragPointer ? (
      <div
        className="pointer-events-none fixed z-50"
        style={{ left: dragPointer.x - 72, top: dragPointer.y - 22 }}
      >
        <div
          className={[
            "flex max-w-[10rem] items-center gap-2 rounded-xl border px-3 py-1.5 shadow-modal bg-surface-container-highest",
            dropOverBlocked ? "vault-list-drag-chip-blocked" : "vault-list-drag-chip",
          ].join(" ")}
        >
          <Icon name="grip-vertical" size={16} className="shrink-0 text-on-surface-variant" />
          <span className="truncate text-sm text-on-surface">{dragChipLabel}</span>
        </div>
      </div>
    ) : null;

  if (rows.length === 0) {
    return (
      <VaultListEmptyState
        allVaultsHidden={allVaultsHidden}
        searchNoMatches={searchNoMatches}
        onCreateFromScratch={onCreateFromScratch}
        onImportPackage={onImportPackage}
      />
    );
  }

  if (viewMode === "blocks") {
    const renderBlockCard = (
      vault: VaultListItem,
      drag: {
        dragDisabled: boolean;
        dropKey: string;
        dragHandleLabel: string;
      },
    ) => (
      <VaultBlockCard
        key={vault.id}
        vault={vault}
        dropKey={drag.dropKey}
        pipelineListStatus={pipelineListStatus}
        isPipelineBusy={isVaultPipelineBusy(vault.id)}
        dragDisabled={drag.dragDisabled}
        dragHandleLabel={drag.dragHandleLabel}
        isDragging={draggingId === drag.dropKey}
        isDragOver={isDropOver(drag.dropKey)}
        isDropBlocked={dropOverBlocked}
        isReorderActive={draggingId !== null}
        pointerDrag={pointerDrag}
        onOpenBackups={onOpenBackups}
        onOpenNote={onOpenNote}
        onOpenVaultInfo={onOpenVaultInfo}
        onOpenSettings={onOpenSettings}
        onExportVault={onExportVault}
        onOpenFolder={onOpenFolder}
        onOpenFileManager={onOpenFileManager}
        onLockVault={onLockVault}
        onUnlockVault={onUnlockVault}
      />
    );

    return (
      <div
        className="relative"
        {...(draggingGroupedVaultSourceGroupId
          ? vaultListDropKeyProps(LIST_ROOT_UNGROUP_DRAG_KEY)
          : {})}
      >
        <div ref={gridRef} className={blocksGridClass(blockColumns)}>
          {rows.map((row) => {
            if (row.kind === "vault") {
              const key = rootRowDragKey(row);
              return renderBlockCard(row.vault, {
                dragDisabled: !vaultListShowDrag || (!canReorder && !vaultListAllowDragIntoGroup),
                dropKey: key,
                dragHandleLabel: canReorder ? reorderHandleLabel : groupHandleLabel,
              });
            }

            const groupKey = rootRowDragKey(row);
            const childrenVisible = !row.group.collapsed && row.groupedVaults.length > 0;
            const showUngroupInGroup = draggingGroupedVaultSourceGroupId === row.group.id;
            const groupOpen = !row.group.collapsed || showUngroupInGroup;
            const bodyVisible = childrenVisible || showUngroupInGroup;
            const visibleMembers = childrenVisible ? row.groupedVaults.length : 0;
            const span = vaultBlocksGroupColumnSpan(visibleMembers, blockColumns);
            const innerColumns = vaultBlocksGroupInnerColumns(visibleMembers, blockColumns);

            const groupDragOver = isDropOver(groupKey);

            return (
              <div
                key={groupKey}
                {...vaultListDropKeyProps(groupKey)}
                className={[
                  "min-w-0 w-full overflow-visible rounded-xl",
                  groupOpen
                    ? "border border-outline-variant bg-surface-container-low"
                    : "border border-transparent bg-surface-container",
                  vaultListDropOverClass(groupDragOver, dropOverBlocked),
                ].join(" ")}
                style={{ gridColumn: `span ${span}` }}
              >
                <VaultGroupRow
                  group={row.group}
                  dropKey={groupKey}
                  groupedVaultCount={row.groupedVaults.length}
                  viewMode={viewMode}
                  dragDisabled={!vaultListShowDrag || !canReorder}
                  isDragging={draggingId === groupKey}
                  expanded={bodyVisible}
                  pointerDrag={pointerDrag}
                  onToggleCollapsed={onToggleGroupCollapsed}
                  onOpenSettings={onOpenGroupSettings}
                />
                {bodyVisible ? (
                  <div className={blocksGroupInnerClass(innerColumns)}>
                    {childrenVisible
                      ? row.groupedVaults.map((vault) => {
                          const groupedVaultKey = groupedVaultDragKey(row.group.id, vault.id);
                          const groupedVaultReorder =
                            vaultListShowDrag &&
                            canReorderGroupedVaults(groupedVaultSortOf(row.group));
                          return renderBlockCard(vault, {
                            dragDisabled:
                              !vaultListShowDrag ||
                              (!groupedVaultReorder && !vaultListAllowDragIntoGroup),
                            dropKey: groupedVaultKey,
                            dragHandleLabel: groupedVaultReorder
                              ? reorderHandleLabel
                              : groupHandleLabel,
                          });
                        })
                      : null}
                    {showUngroupInGroup
                      ? renderGroupUngroupDrop(row.group.id, "col-span-full")
                      : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {dragChip}
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>
    );
  }

  const listGap =
    viewMode === "compact" ? "space-y-3" : viewMode === "large" ? "space-y-4" : "space-y-4";

  return (
    <div
      className={`relative overflow-visible ${listGap}`}
      {...(draggingGroupedVaultSourceGroupId
        ? vaultListDropKeyProps(LIST_ROOT_UNGROUP_DRAG_KEY)
        : {})}
    >
      {rows.map((row) => {
        if (row.kind === "vault") {
          const key = rootRowDragKey(row);
          return (
            <VaultRow
              key={key}
              vault={row.vault}
              dropKey={key}
              pipelineListStatus={pipelineListStatus}
              viewMode={viewMode}
              dragDisabled={!vaultListShowDrag || (!canReorder && !vaultListAllowDragIntoGroup)}
              dragHandleLabel={canReorder ? reorderHandleLabel : groupHandleLabel}
              isDragging={draggingId === key}
              isDragOver={isDropOver(key)}
              isDropBlocked={dropOverBlocked}
              isReorderActive={draggingId !== null}
              isPipelineBusy={isVaultPipelineBusy(row.vault.id)}
              pointerDrag={pointerDrag}
              onOpenBackups={onOpenBackups}
              onOpenNote={onOpenNote}
              onOpenVaultInfo={onOpenVaultInfo}
              onOpenSettings={onOpenSettings}
              onExportVault={onExportVault}
              onOpenFolder={onOpenFolder}
              onOpenFileManager={onOpenFileManager}
              onLockVault={onLockVault}
              onUnlockVault={onUnlockVault}
            />
          );
        }

        const groupKey = rootRowDragKey(row);
        const childrenVisible = !row.group.collapsed && row.groupedVaults.length > 0;
        const showUngroupInGroup = draggingGroupedVaultSourceGroupId === row.group.id;
        const groupOpen = !row.group.collapsed || showUngroupInGroup;
        const bodyVisible = childrenVisible || showUngroupInGroup;
        const groupDragOver = isDropOver(groupKey);
        return (
          <div
            key={groupKey}
            {...vaultListDropKeyProps(groupKey)}
            className={[
              "vault-group relative z-0 overflow-visible rounded-xl",
              groupOpen
                ? "border border-outline-variant bg-surface-container-low"
                : "border border-transparent bg-surface-container",
              vaultListDropOverClass(groupDragOver, dropOverBlocked),
            ].join(" ")}
          >
            <VaultGroupRow
              group={row.group}
              dropKey={groupKey}
              groupedVaultCount={row.groupedVaults.length}
              viewMode={viewMode}
              dragDisabled={!vaultListShowDrag || !canReorder}
              isDragging={draggingId === groupKey}
              expanded={bodyVisible}
              pointerDrag={pointerDrag}
              onToggleCollapsed={onToggleGroupCollapsed}
              onOpenSettings={onOpenGroupSettings}
            />
            {bodyVisible ? (
              <div className="space-y-3 px-1.5 pb-2 pt-0 sm:px-2">
                {childrenVisible
                  ? row.groupedVaults.map((vault) => {
                      const groupedVaultKey = groupedVaultDragKey(row.group.id, vault.id);
                      const groupedVaultReorder =
                        vaultListShowDrag && canReorderGroupedVaults(groupedVaultSortOf(row.group));
                      return (
                        <VaultRow
                          key={vault.id}
                          vault={vault}
                          dropKey={groupedVaultKey}
                          pipelineListStatus={pipelineListStatus}
                          viewMode={viewMode}
                          dragDisabled={
                            !vaultListShowDrag ||
                            (!groupedVaultReorder && !vaultListAllowDragIntoGroup)
                          }
                          dragHandleLabel={
                            groupedVaultReorder ? reorderHandleLabel : groupHandleLabel
                          }
                          isDragging={draggingId === groupedVaultKey}
                          isDragOver={isDropOver(groupedVaultKey)}
                          isDropBlocked={dropOverBlocked}
                          isReorderActive={draggingId !== null}
                          isPipelineBusy={isVaultPipelineBusy(vault.id)}
                          pointerDrag={pointerDrag}
                          onOpenBackups={onOpenBackups}
                          onOpenNote={onOpenNote}
                          onOpenVaultInfo={onOpenVaultInfo}
                          onOpenSettings={onOpenSettings}
                          onExportVault={onExportVault}
                          onOpenFolder={onOpenFolder}
                          onOpenFileManager={onOpenFileManager}
                          onLockVault={onLockVault}
                          onUnlockVault={onUnlockVault}
                        />
                      );
                    })
                  : null}
                {showUngroupInGroup ? renderGroupUngroupDrop(row.group.id) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {dragChip}
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
