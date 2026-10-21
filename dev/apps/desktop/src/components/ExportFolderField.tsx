import { useId } from "react";
import { exportFolderIssue } from "@upriv/shared";
import { PathField } from "@/components/PathField";
import { SettingsField } from "@/components/settings";
import { Button } from "@/components/ui";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";

interface ExportFolderFieldProps {
  folder: ExportFolder;
  /** Under the label: what the export writes there. */
  hint?: string;
  /** Locked while the export runs. */
  disabled?: boolean;
}

/**
 * Where an export goes: a folder typed or picked, checked as it is typed. The
 * export itself starts from its window's own button.
 */
export function ExportFolderField({ folder, hint, disabled = false }: ExportFolderFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const notAbsolute = exportFolderIssue(folder.path) === "folder_not_absolute";

  return (
    <SettingsField label={t("modal.export_folder.label")} hint={hint} htmlFor={id}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <PathField
          id={id}
          className="sm:flex-1"
          value={folder.path}
          onChange={folder.setPath}
          disabled={disabled}
          invalid={notAbsolute}
          placeholder={t("modal.folder_field.placeholder")}
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="w-full shrink-0 sm:w-auto"
          disabled={disabled || folder.picking}
          onClick={folder.choose}
        >
          {t("modal.export_folder.choose")}
        </Button>
      </div>
      {notAbsolute ? (
        <p className="text-xs leading-relaxed text-on-error-container" role="alert">
          {t("modal.workspace.error.not_absolute")}
        </p>
      ) : null}
      {folder.pickFailed ? (
        <p className="text-xs leading-relaxed text-on-error-container" role="alert">
          {t("error.unexpected")}
        </p>
      ) : null}
    </SettingsField>
  );
}
