import { type ReactNode } from "react";
import { FileManagerProvider as SharedFileManagerProvider, useFileManager } from "@upriv/shared/react";
import { useVaultFileSystemService } from "@/platform/services";

export { useFileManager };

export function FileManagerProvider({ children }: { children: ReactNode }) {
  const fs = useVaultFileSystemService();
  return <SharedFileManagerProvider fs={fs}>{children}</SharedFileManagerProvider>;
}
