import type { InfoField } from "@upriv/shared";
import { RevealPathButton } from "@/components/RevealPathButton";
import { useTranslation } from "@/i18n";

interface InfoFieldListProps {
  fields: InfoField[];
}

/** Label and value rows; a value still being read shows a skeleton bar in its place. */
export function InfoFieldList({ fields }: InfoFieldListProps) {
  const { t } = useTranslation();
  return (
    <dl className="space-y-2.5">
      {fields.map((field) => (
        <div
          key={field.id}
          className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(9rem,38%)_1fr] sm:gap-x-4"
        >
          <dt className="text-xs text-on-surface-variant">{field.label}</dt>
          <dd className="flex min-w-0 items-start gap-1">
            {field.loading ? (
              <span
                role="status"
                aria-label={t("modal.info.loading")}
                className="mt-1.5 block h-2.5 w-2/5 animate-pulse rounded bg-on-surface-variant/20 motion-reduce:animate-none"
              />
            ) : (
              <>
                <span className="min-w-0 flex-1 break-all font-mono text-sm text-on-surface">
                  {field.href ? (
                    <a href={field.href} target="_blank" rel="noreferrer" className="underline">
                      {field.value}
                    </a>
                  ) : (
                    field.value
                  )}
                </span>
                <RevealPathButton path={field.openPath} />
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
