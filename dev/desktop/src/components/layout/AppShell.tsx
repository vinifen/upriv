import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { CenteredPanel } from "./CenteredPanel";

interface AppShellProps {
  /** Custom header (e.g. VaultListHeader). Falls back to AppHeader when omitted. */
  header?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  mainClassName?: string;
}

/** Root layout: header + centered main column. */
export function AppShell({
  header,
  headerActions,
  children,
  contentClassName,
  mainClassName = "py-10 md:py-12",
}: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      {header ?? <AppHeader actions={headerActions} />}
      <main className={["flex flex-1 flex-col", mainClassName].filter(Boolean).join(" ")}>
        <CenteredPanel className={contentClassName}>{children}</CenteredPanel>
      </main>
    </div>
  );
}

export { AppHeader } from "./AppHeader";
export { CenteredPanel } from "./CenteredPanel";
