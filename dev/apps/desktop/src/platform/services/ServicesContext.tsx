import { createContext, useContext, type ReactNode } from "react";
import type { AppServices } from "@upriv/shared";

const ServicesContext = createContext<AppServices | null>(null);

interface ServicesProviderProps {
  services: AppServices;
  children: ReactNode;
}

export function ServicesProvider({ services, children }: ServicesProviderProps) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) {
    throw new Error("useServices must be used within ServicesProvider");
  }
  return ctx;
}

export function useVaultService(): AppServices["vault"] {
  return useServices().vault;
}

export function useAppSettingsService(): AppServices["appSettings"] {
  return useServices().appSettings;
}

export function useBackupService(): AppServices["backups"] {
  return useServices().backups;
}

export function useLogService(): AppServices["logs"] {
  return useServices().logs;
}

export function useVaultFileSystemService(): AppServices["filesystem"] {
  return useServices().filesystem;
}

export function useVaultLifecycleService(): AppServices["lifecycle"] {
  return useServices().lifecycle;
}

export function useCreateVaultService(): AppServices["createVault"] {
  return useServices().createVault;
}

export function useVaultRootService(): AppServices["vaultRoot"] {
  return useServices().vaultRoot;
}
