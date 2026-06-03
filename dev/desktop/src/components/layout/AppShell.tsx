import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { CenteredPanel } from "./CenteredPanel";

interface AppShellProps {
  headerActions?: ReactNode;
  children: ReactNode;
}

/** Root layout: header + centered main column. */
export function AppShell({ headerActions, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <AppHeader actions={headerActions} />
      <main className="flex flex-1 flex-col py-8 md:py-12">
        <CenteredPanel>{children}</CenteredPanel>
      </main>
    </div>
  );
}

export { AppHeader } from "./AppHeader";
export { CenteredPanel } from "./CenteredPanel";
