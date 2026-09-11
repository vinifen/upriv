import { createContext, useContext, type ReactNode } from "react";
import type { AppServices } from "@upriv/shared";

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used within ServicesProvider");
  return ctx;
}

export function useVaultService() {
  return useServices().vault;
}
export function useVaultGroupService() {
  return useServices().vaultGroups;
}
export function useAppSettingsService() {
  return useServices().appSettings;
}
export function useBackupService() {
  return useServices().backups;
}
export function useLogService() {
  return useServices().logs;
}
export function useVaultFileSystemService() {
  return useServices().filesystem;
}
export function useVaultLifecycleService() {
  return useServices().lifecycle;
}
export function useCreateVaultService() {
  return useServices().createVault;
}
export function useVaultRootService() {
  return useServices().vaultRoot;
}
export function useVaultSecurityService() {
  return useServices().vaultSecurity;
}
