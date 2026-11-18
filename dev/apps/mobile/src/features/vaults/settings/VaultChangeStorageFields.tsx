import { View } from "react-native";
import {
  plainFolderNote,
  requireVaultConfigEditLockedI18nKey,
  type ChangeStorageFieldsState,
  type VaultStorage,
} from "@upriv/shared";
import { useUnlockedDestination } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { rpcVaultUnlockedDestination } from "@/lib/rpc";
import { spacing } from "@/theme/tokens";
import {
  FieldHint,
  FieldLabel,
  PasswordInput,
  UnlockedFolderLineView,
} from "@/components/settings";
import { Warning } from "@/components/settings/settingsFields";
import { VaultSettingsStorageSection } from "./vaultSettingsForm";

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
}: {
  vaultId: string;
  /** The copy in `config.toml`, which the screen starts from. */
  current: VaultStorage;
  /** Blocked when the vault is not strictly closed (`vault_closed` gate). */
  blocked: boolean;
  fields: ChangeStorageFieldsState;
  onChange: (patch: Partial<ChangeStorageFieldsState>) => void;
  /** Wrong password: shown under that field. */
  passwordFieldError?: string | null;
  error?: string | null;
  /** This change is already running. */
  busy?: boolean;
}) {
  const { t } = useTranslation();
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
    <View style={{ gap: spacing.md }}>
      <VaultSettingsStorageSection
        config={fields.storage}
        disabled={locked}
        disabledLine={
          blocked ? t(requireVaultConfigEditLockedI18nKey("action.change_storage")) : null
        }
        onChange={(patch) => onChange({ storage: { ...fields.storage, ...patch } })}
        plainNote={
          <UnlockedFolderLineView
            checking={destination.checking}
            line={destination.answer ? plainFolderNote(destination.answer) : null}
            checkingKey="modal.storage.note.checking"
          />
        }
      />
      <FieldHint>{t("vault.change_storage.no_conversion")}</FieldHint>
      <FieldLabel disabled={locked}>{t("vault.change_storage.password")}</FieldLabel>
      <PasswordInput
        value={fields.password}
        disabled={locked}
        invalid={Boolean(passwordFieldError)}
        onChangeText={(password) => onChange({ password })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {passwordFieldError ? <Warning>{passwordFieldError}</Warning> : null}
      {unchanged && fields.password.length > 0 ? (
        <Warning>{t("vault.change_storage.same_as_current")}</Warning>
      ) : null}
      {error ? <Warning>{error}</Warning> : null}
    </View>
  );
}
