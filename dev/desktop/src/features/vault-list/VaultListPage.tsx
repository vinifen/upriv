import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { MOCK_VAULTS } from "./mockVaults";
import { VaultList } from "./VaultList";
import { VaultListHeader, useRefreshState } from "./VaultListHeader";
import { VaultNoteModal } from "./VaultNoteModal";
import { useVaultListOrder } from "./useVaultListOrder";

export function VaultListPage() {
  const { t } = useTranslation();
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const {
    vaults,
    draggingId,
    dragOverId,
    resetOrder,
    updateNote,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  } = useVaultListOrder(MOCK_VAULTS);

  const noteVault = useMemo(
    () => vaults.find((vault) => vault.id === noteVaultId) ?? null,
    [vaults, noteVaultId],
  );

  const handleRefresh = useCallback(() => {
    resetOrder();
    runRefreshAnimation();
  }, [resetOrder, runRefreshAnimation]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <VaultListHeader onRefresh={handleRefresh} isRefreshing={isRefreshing} />
      <main className="flex flex-1 flex-col items-center py-10 md:py-12">
        <section className="w-full max-w-vault-list px-margin-mobile md:px-margin-desktop">
          <div className="mb-10 text-center md:text-left">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface md:text-3xl">
              {t("vault.list.title")}
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">{t("vault.list.subtitle")}</p>
          </div>
          <VaultList
            vaults={vaults}
            draggingId={draggingId}
            dragOverId={dragOverId}
            onOpenNote={setNoteVaultId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        </section>
      </main>
      <VaultNoteModal
        vault={noteVault}
        open={noteVaultId !== null}
        onClose={() => setNoteVaultId(null)}
        onNoteChange={updateNote}
      />
    </div>
  );
}
