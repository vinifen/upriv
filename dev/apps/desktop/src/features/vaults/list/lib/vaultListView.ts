/** Desktop-only Tailwind density tokens per list view mode.
 * Numeric sizes live in `@upriv/shared` `VAULT_ROW_DENSITY` (mobile uses those). */
export const vaultRowDensityClass = {
  default: {
    article: "py-6",
    title: "text-lg",
    icon: "h-10 w-10",
    iconSize: 20 as const,
    letters: "text-[14px] font-semibold leading-none tracking-tight",
  },
  large: {
    article: "py-10",
    title: "text-xl",
    icon: "h-12 w-12",
    iconSize: 24 as const,
    letters: "text-[16px] font-semibold leading-none tracking-tight",
  },
  compact: {
    article: "py-4",
    title: "text-base",
    icon: "h-8 w-8",
    iconSize: 18 as const,
    letters: "text-[12px] font-semibold leading-none tracking-tight",
  },
  blocks: {
    article: "py-5",
    title: "text-base",
    icon: "h-10 w-10",
    iconSize: 20 as const,
    letters: "text-[14px] font-semibold leading-none tracking-tight",
  },
} as const;
