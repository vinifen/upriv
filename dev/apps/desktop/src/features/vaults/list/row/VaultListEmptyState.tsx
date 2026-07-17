import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface VaultListEmptyStateProps {
  allVaultsHidden?: boolean;
  onCreateFromScratch: () => void;
  onImportArchive: () => void;
}

/** Empty vault list: create / import CTAs (and drop hint) instead of plain copy. */
export function VaultListEmptyState({
  allVaultsHidden = false,
  onCreateFromScratch,
  onImportArchive,
}: VaultListEmptyStateProps) {
  const { t } = useTranslation();

  if (allVaultsHidden) {
    return (
      <p className="py-16 text-center font-mono text-sm uppercase tracking-widest text-on-surface-variant">
        {t("empty.vaults_all_hidden")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center sm:py-16">
      <div className="space-y-2">
        <p className="font-mono text-sm uppercase tracking-widest text-on-surface-variant">
          {t("empty.no_vaults")}
        </p>
        <p className="max-w-md text-sm text-on-surface-variant">{t("empty.no_vaults_hint")}</p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
        <Button
          type="button"
          variant="primary"
          size="md"
          className="gap-2 rounded-xl"
          onClick={onCreateFromScratch}
        >
          <Icon name="add" size={18} />
          {t("empty.action.create_vault")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="gap-2 rounded-xl"
          onClick={onImportArchive}
        >
          <Icon name="archive" size={18} />
          {t("empty.action.import_archive")}
        </Button>
      </div>

      <p className="max-w-sm text-xs text-on-surface-variant/80">
        {t("empty.no_vaults_drop_hint")}
      </p>
    </div>
  );
}
