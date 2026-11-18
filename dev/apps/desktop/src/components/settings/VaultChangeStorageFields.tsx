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
  /** This change is already running. */
  busy?: boolean;
}

/**
 * The Storage screen: the two options, the folder plain text would fill on
 * this device, and the vault's password, which seals the choice.
 */
export function VaultChangeStorageFields({
  vaultId,
  current,
  blocked,
  fields,
  onChange,
  passwordFieldError,
  error,
  busy = false,
}: VaultChangeStorageFieldsProps) {
  const { t } = useTranslation();
  const passwordId = useId();
  const locked = blocked || busy;
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
        disabled={locked}
        onChange={(patch) => onChange({ storage: { ...fields.storage, ...patch } })}
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

      <SettingsField
        label={t("vault.change_storage.password")}
        htmlFor={passwordId}
        disabled={locked}
      >
        <PasswordInput
          id={passwordId}
          value={fields.password}
          disabled={locked}
          aria-invalid={passwordFieldError ? true : undefined}
          aria-errormessage={passwordFieldError ? `${passwordId}-error` : undefined}
          onChange={(e) => onChange({ password: e.target.value })}
          autoComplete="current-password"
          inputClassName={[settingsControlClass, settingsInvalidControlClass].join(" ")}
        />
        {passwordFieldError ? (
          <p id={`${passwordId}-error`} role="alert" className="text-xs text-on-error-container">
            {passwordFieldError}
          </p>
        ) : null}
      </SettingsField>

      {unchanged && fields.password.length > 0 ? (
        <p className="text-xs text-on-error-container">
          {t("vault.change_storage.same_as_current")}
        </p>
      ) : null}
      {error ? <p className="text-xs text-on-error-container">{error}</p> : null}
    </div>
  );
}
