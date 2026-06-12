import type { VaultDisplayStatus } from "@upriv/shared";
import { vaultStatusColorVar } from "@/theme";

export interface StatusDotProps {
  status: VaultDisplayStatus;
  className?: string;
}

export function StatusDot({ status, className = "" }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-hidden
      className={["inline-block h-2.5 w-2.5 shrink-0 rounded-full", className].join(" ")}
      style={{ backgroundColor: `var(${vaultStatusColorVar[status]})` }}
    />
  );
}
