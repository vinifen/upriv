import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultDragHandleProps {
  vaultId: string;
  onDragStart: (vaultId: string) => (event: React.DragEvent) => void;
  onDragEnd: () => void;
}

export function VaultDragHandle({ vaultId, onDragStart, onDragEnd }: VaultDragHandleProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      draggable
      aria-label={t("action.drag_reorder")}
      title={t("action.drag_reorder")}
      className={[
        "flex h-10 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg -mr-2",
        "text-on-surface-variant transition-colors",
        "hover:bg-surface-container-highest hover:text-on-surface",
        "active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      ].join(" ")}
      onDragStart={onDragStart(vaultId)}
      onDragEnd={onDragEnd}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Icon name="grip-vertical" size={18} />
    </button>
  );
}
