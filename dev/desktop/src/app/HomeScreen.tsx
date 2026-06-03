import { Button } from "@/components/ui";
import { AppShell } from "@/components/layout";
import { useTranslation } from "@/i18n";

/** Home screen — vault list will live here (PRD §3.7.1). */
export function HomeScreen() {
  const { t } = useTranslation();

  return (
    <AppShell
      headerActions={
        <Button variant="primary" size="sm">
          {t("app.new_vault")}
        </Button>
      }
    >
      <section className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="font-mono text-sm uppercase tracking-widest text-on-surface-variant">
          {t("empty.no_vaults")}
        </p>
      </section>
    </AppShell>
  );
}
