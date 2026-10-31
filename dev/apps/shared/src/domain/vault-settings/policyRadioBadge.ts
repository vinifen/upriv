import type { I18nKey } from "../../i18n/catalog";

/** Visual badge on a `PolicyRadioOption` (kebab in the prop, snake in i18n). */
export type PolicyRadioBadge =
  | "recommended"
  | "less-secure"
  | "not-recommended"
  | "insecure"
  | "default"
  | "more-secure"
  | "in-use";

/** Prop value → catalog key. One table so desktop and mobile cannot drift. */
export const POLICY_RADIO_BADGE_I18N = {
  recommended: "modal.settings.badge.recommended",
  "less-secure": "modal.settings.badge.less_secure",
  "not-recommended": "modal.settings.badge.not_recommended",
  insecure: "modal.settings.badge.insecure",
  default: "modal.settings.badge.default",
  "more-secure": "modal.settings.badge.more_secure",
  "in-use": "modal.settings.badge.in_use",
} as const satisfies Record<PolicyRadioBadge, I18nKey>;

/** `PolicyRadioOption` takes one badge or several, shown in this order. */
export function policyRadioBadgeList(
  badge: PolicyRadioBadge | readonly PolicyRadioBadge[] | undefined,
): readonly PolicyRadioBadge[] {
  if (badge === undefined) return [];
  return typeof badge === "string" ? [badge] : badge;
}
