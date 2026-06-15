import {
  type CreateVaultValidationCode,
  createVaultErrorKey as createVaultErrorKeyShared,
} from "@upriv/shared";
import type { I18nKey } from "@/i18n";

export function createVaultErrorKey(code: CreateVaultValidationCode): I18nKey {
  return createVaultErrorKeyShared(code) as I18nKey;
}
