export type VaultLifecycleIntent = "unlock" | "close" | "seal";

export interface VaultLifecycleRequest {
  vaultId: string;
  intent: VaultLifecycleIntent;
}
