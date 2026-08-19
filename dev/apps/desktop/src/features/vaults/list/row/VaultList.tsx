import {
  canReorderGroupedVaults,
  flattenVisibleHierarchyRows,
  groupedVaultSortOf,
  rootRowDragKey,
  type VaultListItem,
  type VaultListRootRow,
  type VaultListViewMode,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { VaultBlockCard } from "./VaultBlockCard";
import { VaultGroupRow } from "./VaultGroupRow";
import { VaultListEmptyState } from "./VaultListEmptyState";
import { VaultRow } from "./VaultRow";

const LIST_UNGROUP_DRAG_KEY = "list:ungroup";

export interface VaultPipelineListStatus {
  openingVaultIds?: readonly string[];
  closingVaultIds?: readonly string[];
}

interface VaultListProps {
  rows: VaultListRootRow[];
  pipelineListStatus?: VaultPipelineListStatus;
  isVaultPipelineBusy?: (vaultId: string) => boolean;
  allVaultsHidden?: boolean;
  viewMode: VaultListViewMode;
  canReorder: boolean;
  allowDragVaultIntoGroup?: boolean;
  draggingId: string | null;
  dragOverId: string | null;
  onCreateFromScratch: () => void;
  onImportArchive: () => void;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
  onOpenGroupAssignment: (vaultId: string) => void;
  onOpenGroupSettings: (groupId: string) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onSealVault: (vault: VaultListItem) => void;
  onRootDragStart: (row: VaultListRootRow) => (event: React.DragEvent) => void;
  onRootDragOver: (row: VaultListRootRow) => (event: React.DragEvent) => void;
  onRootDrop: (row: VaultListRootRow) => (event: React.DragEvent) => void;
  onUngroupDragOver: (event: React.DragEvent) => void;
  onUngroupDrop: (event: React.DragEvent) => void;
  onMemberDragStart: (groupId: string, vaultId: string) => (event: React.DragEvent) => void;
  onMemberDragOver: (groupId: string, vaultId: string) => (event: React.DragEvent) => void;
  onMemberDrop: (groupId: string, vaultId: string) => (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragLeave: (id: string) => () => void;
}

export function VaultList({
  rows,
  pipelineListStatus = {},
  isVaultPipelineBusy = () => false,
  allVaultsHidden = false,
  viewMode,
  canReorder,
  allowDragVaultIntoGroup = true,
  draggingId,
  dragOverId,
  onCreateFromScratch,
  onImportArchive,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
  onOpenGroupAssignment,
  onOpenGroupSettings,
  onToggleGroupCollapsed,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onSealVault,
  onRootDragStart,
  onRootDragOver,
  onRootDrop,
  onUngroupDragOver,
  onUngroupDrop,
  onMemberDragStart,
  onMemberDragOver,
  onMemberDrop,
  onDragEnd,
  onDragLeave,
}: VaultListProps) {
  const { t } = useTranslation();
  const draggingMemberGroupId =
    allowDragVaultIntoGroup && draggingId?.startsWith("member:")
      ? draggingId.split(":")[1] ?? null
      : null;

  if (rows.length === 0) {
    return (
      <VaultListEmptyState
        allVaultsHidden={allVaultsHidden}
        onCreateFromScratch={onCreateFromScratch}
        onImportArchive={onImportArchive}
      />
    );
  }

  if (viewMode === "blocks") {
    const flat = flattenVisibleHierarchyRows(rows, { includeCollapsedGroupedVaults: true });
    return (
      <div className="relative">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {flat.map((vault) => (
            <VaultBlockCard
              key={vault.id}
              vault={vault}
              pipelineListStatus={pipelineListStatus}
              isPipelineBusy={isVaultPipelineBusy(vault.id)}
              onOpenBackups={onOpenBackups}
              onOpenNote={onOpenNote}
              onOpenSettings={onOpenSettings}
              onOpenGroupAssignment={onOpenGroupAssignment}
              onExportVault={onExportVault}
              onOpenFolder={onOpenFolder}
              onOpenFileManager={onOpenFileManager}
              onLockVault={onLockVault}
              onUnlockVault={onUnlockVault}
              onSealVault={onSealVault}
            />
          ))}
        </div>
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>
    );
  }

  const listGap =
    viewMode === "compact" ? "space-y-3" : viewMode === "large" ? "space-y-4" : "space-y-4";

  return (
    <div
      className={`relative overflow-visible ${listGap}`}
      onDragOver={(event) => {
        if (event.target !== event.currentTarget) return;
        onUngroupDragOver(event);
      }}
      onDragLeave={(event) => {
        if (event.target !== event.currentTarget) return;
        onDragLeave(LIST_UNGROUP_DRAG_KEY)();
      }}
      onDrop={(event) => {
        if (event.target !== event.currentTarget) return;
        onUngroupDrop(event);
      }}
    >
      {rows.map((row) => {
        if (row.kind === "vault") {
          const key = rootRowDragKey(row);
          return (
            <VaultRow
              key={key}
              vault={row.vault}
              pipelineListStatus={pipelineListStatus}
              viewMode={viewMode}
              dragDisabled={!canReorder && !allowDragVaultIntoGroup}
              isDragging={draggingId === key}
              isDragOver={dragOverId === key && draggingId !== key}
              isReorderActive={draggingId !== null}
              isPipelineBusy={isVaultPipelineBusy(row.vault.id)}
              onOpenBackups={onOpenBackups}
              onOpenNote={onOpenNote}
              onOpenSettings={onOpenSettings}
              onOpenGroupAssignment={onOpenGroupAssignment}
              onExportVault={onExportVault}
              onOpenFolder={onOpenFolder}
              onOpenFileManager={onOpenFileManager}
              onLockVault={onLockVault}
              onUnlockVault={onUnlockVault}
              onSealVault={onSealVault}
              onDragStart={onRootDragStart(row)}
              onDragEnd={onDragEnd}
              onDragOver={onRootDragOver(row)}
              onDragLeave={onDragLeave(key)}
              onDrop={onRootDrop(row)}
            />
          );
        }

        const groupKey = rootRowDragKey(row);
        const childrenVisible = !row.group.collapsed && row.groupedVaults.length > 0;
        const showUngroupInGroup = draggingMemberGroupId === row.group.id;
        const groupOpen = !row.group.collapsed || showUngroupInGroup;
        const bodyVisible = childrenVisible || showUngroupInGroup;
        return (
          <div
            key={groupKey}
            className={[
              "relative z-0 overflow-visible rounded-xl",
              // Collapsed: match vault rows, no border; open: transparent + solid gray edge.
              // Opaque outline (not /opacity) — translucent gray reads blue over the navy canvas.
              groupOpen
                ? "border border-outline-variant bg-transparent"
                : "border border-transparent bg-surface-container",
            ].join(" ")}
            onDragOver={onRootDragOver(row)}
            onDragLeave={onDragLeave(groupKey)}
            onDrop={onRootDrop(row)}
          >
            <VaultGroupRow
              group={row.group}
              groupedVaultCount={row.groupedVaults.length}
              viewMode={viewMode}
              dragDisabled={!canReorder}
              isDragging={draggingId === groupKey}
              isDragOver={dragOverId === groupKey && draggingId !== groupKey}
              expanded={bodyVisible}
              onToggleCollapsed={onToggleGroupCollapsed}
              onOpenSettings={onOpenGroupSettings}
              onDragStart={onRootDragStart(row)}
              onDragEnd={onDragEnd}
              onDragOver={onRootDragOver(row)}
              onDragLeave={onDragLeave(groupKey)}
              onDrop={onRootDrop(row)}
            />
            {bodyVisible ? (
              <div className="space-y-2 px-1.5 pb-1.5 pt-0 sm:px-2">
                {childrenVisible
                  ? row.groupedVaults.map((vault) => {
                      const groupedVaultKey = `member:${row.group.id}:${vault.id}`;
                      const groupedVaultReorder = canReorderGroupedVaults(
                        groupedVaultSortOf(row.group),
                      );
                      return (
                        <VaultRow
                          key={vault.id}
                          vault={vault}
                          pipelineListStatus={pipelineListStatus}
                          viewMode={viewMode}
                          dragDisabled={!groupedVaultReorder && !allowDragVaultIntoGroup}
                          isDragging={draggingId === groupedVaultKey}
                          isDragOver={
                            dragOverId === groupedVaultKey && draggingId !== groupedVaultKey
                          }
                          isReorderActive={draggingId !== null}
                          isPipelineBusy={isVaultPipelineBusy(vault.id)}
                          onOpenBackups={onOpenBackups}
                          onOpenNote={onOpenNote}
                          onOpenSettings={onOpenSettings}
                          onOpenGroupAssignment={onOpenGroupAssignment}
                          onExportVault={onExportVault}
                          onOpenFolder={onOpenFolder}
                          onOpenFileManager={onOpenFileManager}
                          onLockVault={onLockVault}
                          onUnlockVault={onUnlockVault}
                          onSealVault={onSealVault}
                          onDragStart={onMemberDragStart(row.group.id, vault.id)}
                          onDragEnd={onDragEnd}
                          onDragOver={onMemberDragOver(row.group.id, vault.id)}
                          onDragLeave={onDragLeave(groupedVaultKey)}
                          onDrop={onMemberDrop(row.group.id, vault.id)}
                        />
                      );
                    })
                  : null}
                {showUngroupInGroup ? (
                  <div
                    role="status"
                    onDragOver={onUngroupDragOver}
                    onDragLeave={onDragLeave(LIST_UNGROUP_DRAG_KEY)}
                    onDrop={onUngroupDrop}
                    className={[
                      "rounded-lg border-2 border-dashed px-3 py-3 text-center text-sm",
                      dragOverId === LIST_UNGROUP_DRAG_KEY
                        ? "border-accent/60 bg-accent/10 text-on-surface"
                        : "border-outline-variant text-on-surface-variant",
                    ].join(" ")}
                  >
                    {t("vault.group.drop_to_ungroup")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
