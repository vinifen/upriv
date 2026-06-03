import type { ReactNode } from "react";
import { useTranslation } from "@/i18n";

interface AppHeaderProps {
  actions?: ReactNode;
}

export function AppHeader({ actions }: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-outline-variant/30 px-margin-mobile py-4 md:px-margin-desktop">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
          {t("app.title")}
        </h1>
        <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-on-surface-variant">
          {t("app.tagline")}
        </p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
