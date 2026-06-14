import type { VaultLifecycleIntent } from "@upriv/shared";

export interface VaultLifecycleRequest {
  vaultId: string;
  intent: VaultLifecycleIntent;
}
