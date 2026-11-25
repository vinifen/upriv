import { useId } from "react";
import {
  plainFolderNote,
  requireVaultConfigEditLockedI18nKey,
  type ChangeStorageFieldsState,
  type VaultStorage,
} from "@upriv/shared";
import { useUnlockedDestination } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { PasswordInput } from "@/components/ui";
import { rpcVaultUnlockedDestination } from "@/lib/rpc";
import { UnlockedFolderLineView } from "./UnlockedFolderLineView";
import {
  settingsControlClass,
  settingsInvalidControlClass,
  SettingsField,
  VaultSettingsStorageSection,
} from "./vaultSettingsForm";

interface VaultChangeStorageFieldsProps {
  vaultId: string;
  /** The copy in `config.toml`, which the screen starts from. */
  current: VaultStorage;
  /** Blocked when the vault is not strictly closed (`vault_closed` gate). */
  blocked: boolean;
  fields: ChangeStorageFieldsState;
  onChange: (patch: Partial<ChangeStorageFieldsState>) => void;
  /** Wrong password — ring and message on that field. */
  passwordFieldError?: string | null;
  error?: string | null;
}

/**
 * The Storage screen, as every change screen lays out: what the change does,
 * the vault's password, which seals the choice, then the two options with
 * the folder plain text would fill on this device.
 */
export function VaultChangeStorageFields({
  vaultId,
  current,
  blocked,
  fields,
  onChange,
  passwordFieldError,
  error,
}: VaultChangeStorageFieldsProps) {
  const { t } = useTranslation();
  const passwordId = useId();
  const destination = useUnlockedDestination(
    rpcVaultUnlockedDestination,
    vaultId,
    "upriv_plain",
    !blocked,
  );
  const unchanged =
    fields.storage.mode === current.mode && fields.storage.plain_files === current.plain_files;

  return (
    <div className="space-y-3">
      {blocked ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t(requireVaultConfigEditLockedI18nKey("action.change_storage"))}
        </p>
      ) : null}

      <VaultSettingsStorageSection
        config={fields.storage}
        disabled={blocked}
        onChange={(patch) => onChange({ storage: { ...fields.storage, ...patch } })}
        aboveChoice={
          <SettingsField
            label={t("vault.change_storage.password")}
            htmlFor={passwordId}
            disabled={blocked}
          >
            <PasswordInput
              id={passwordId}
              value={fields.password}
              disabled={blocked}
              aria-invalid={passwordFieldError ? true : undefined}
              aria-errormessage={passwordFieldError ? `${passwordId}-error` : undefined}
              onChange={(e) => onChange({ password: e.target.value })}
              autoComplete="current-password"
              inputClassName={[settingsControlClass, settingsInvalidControlClass].join(" ")}
            />
            {passwordFieldError ? (
              <p
                id={`${passwordId}-error`}
                role="alert"
                className="text-xs text-on-error-container"
              >
                {passwordFieldError}
              </p>
            ) : null}
          </SettingsField>
        }
        plainNote={
          <UnlockedFolderLineView
            checking={destination.checking}
            line={destination.answer ? plainFolderNote(destination.answer) : null}
            checkingKey="modal.storage.note.checking"
          />
        }
      />
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("vault.change_storage.no_conversion")}
      </p>
      {unchanged && fields.password.length > 0 ? (
        <p className="text-xs text-on-error-container">
          {t("vault.change_storage.same_as_current")}
        </p>
      ) : null}
      {error ? <p className="text-xs text-on-error-container">{error}</p> : null}
    </div>
  );
}
