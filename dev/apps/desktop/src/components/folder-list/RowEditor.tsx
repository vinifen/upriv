import { useEffect, useId, useRef } from "react";
import { ROW_NAME_MAX_CHARS } from "@upriv/shared";
import { PathField } from "@/components/PathField";
import { settingsControlClass } from "@/components/settings";
import { Button } from "@/components/ui";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useTranslation } from "@/i18n";

/**
 * A row's name and path, edited in place under its text. The path is
 * editable text kept as typed, beside Browse… when this device can pick
 * (`pickFolder`). Another device's rows are text only. A path an open vault
 * holds (`pathHeld`) is read only, with why. Each edit goes to the window's
 * draft at once, and the window's own Save, Apply, or Continue writes it;
 * Edit in the row's menu closes the fields again.
 */
export function RowEditor({
  name,
  path,
  pickStart = null,
  pickFolder,
  pathHeld = null,
  onName,
  onPath,
}: {
  name: string;
  path: string;
  pickStart?: string | null;
  pickFolder?: (start: string | null) => Promise<string | null>;
  /** Why the path cannot change now; `null` when it can. */
  pathHeld?: string | null;
  onName: (name: string) => void;
  onPath: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const nameId = useId();
  const pathId = useId();
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A new row opens on its path: the step it still lacks.
    if (!path.trim()) pathRef.current?.focus();
    // Only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = () => {
    if (!pickFolder) return;
    void pickFolder(pickStart)
      .then((picked) => {
        if (picked?.trim()) onPath(picked.trim());
      })
      .catch((error: unknown) => showError(error, "error.unexpected"));
  };

  return (
    <div className="mt-3 grid gap-3 border-t border-outline-variant pt-3">
      <div className="grid gap-1.5">
        <label htmlFor={nameId} className="text-xs font-medium text-on-surface-variant">
          {t("folder_list.field.name")}
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={ROW_NAME_MAX_CHARS}
          placeholder={t("folder_list.field.name_placeholder")}
          onChange={(event) => onName(event.target.value)}
          className={settingsControlClass}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={pathId} className="text-xs font-medium text-on-surface-variant">
          {t("folder_list.field.path")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <PathField
            ref={pathRef}
            id={pathId}
            className="min-w-0 sm:flex-1"
            value={path}
            readOnly={pathHeld !== null}
            placeholder={t("modal.folder_field.placeholder")}
            onChange={onPath}
          />
          {pickFolder && pathHeld === null ? (
            <Button variant="secondary" size="md" className="shrink-0" onClick={choose}>
              {t("folder_list.action.browse")}
            </Button>
          ) : null}
        </div>
        {pathHeld ? (
          <p className="text-xs leading-relaxed text-on-surface-variant">{pathHeld}</p>
        ) : null}
      </div>
    </div>
  );
}
