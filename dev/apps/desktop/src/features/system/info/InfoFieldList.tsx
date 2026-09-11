import type { InfoField } from "@upriv/shared";

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
          <dd className="break-all font-mono text-sm text-on-surface">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}
