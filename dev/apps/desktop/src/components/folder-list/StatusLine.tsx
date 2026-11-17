import type { StatusLine as StatusLineValue } from "@upriv/shared";

/** A row's status, under its path: muted while checking or ready, in the error color for a problem. */
export function StatusLine({ line }: { line: StatusLineValue }) {
  return (
    <span
      role={line.tone === "problem" ? "alert" : "status"}
      className={[
        "mt-1 block text-xs",
        line.tone === "problem" ? "text-on-error-container" : "text-on-surface-variant",
      ].join(" ")}
    >
      {line.text}
    </span>
  );
}
