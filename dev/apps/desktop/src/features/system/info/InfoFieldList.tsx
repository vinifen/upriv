import type { InfoField } from "@upriv/shared";
import { RevealPathButton } from "@/components/RevealPathButton";

interface InfoFieldListProps {
  fields: InfoField[];
}

export function InfoFieldList({ fields }: InfoFieldListProps) {
  return (
    <dl className="space-y-2.5">
      {fields.map((field) => (
        <div
          key={field.id}
          className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(9rem,38%)_1fr] sm:gap-x-4"
        >
          <dt className="text-xs text-on-surface-variant">{field.label}</dt>
          <dd className="flex min-w-0 items-start gap-1">
            <span className="min-w-0 flex-1 break-all font-mono text-sm text-on-surface">
              {field.value}
            </span>
            <RevealPathButton path={field.openPath} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
