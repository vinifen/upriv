import { Fragment, type ReactNode } from "react";
import { breadcrumbShrink, pathBreadcrumbs } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

/** Row under the tabs: vault name › folders › file, plus optional controls. */
export function EditorPathBar({
  vaultName,
  path,
  children,
}: {
  vaultName: string;
  path: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const crumbs = pathBreadcrumbs(vaultName, path);
  const last = crumbs.length - 1;

  return (
    <div className="flex shrink-0 items-center gap-2 bg-surface-container-high py-1 pl-4 pr-2">
      {/* justify-end + trailing spacer: left-aligned when it fits; if it still overflows, the start is clipped. */}
      <nav
        aria-label={t("modal.file_manager.viewer.path_label")}
        title={crumbs.join(" › ")}
        className="flex min-w-0 flex-1 items-center justify-end overflow-hidden text-[11px] leading-5 text-on-surface-variant"
      >
        {crumbs.map((name, index) => (
          <Fragment key={`${index}-${name}`}>
            {index > 0 ? (
              <Icon name="chevron-right" size={10} className="mx-0.5 shrink-0 opacity-70" />
            ) : null}
            <span
              className={[
                "max-w-[12rem] truncate",
                index === last ? "min-w-[2rem] text-on-surface" : "min-w-[1.25rem]",
              ].join(" ")}
              style={{ flexShrink: breadcrumbShrink(index, crumbs.length) }}
            >
              {name}
            </span>
          </Fragment>
        ))}
        <span aria-hidden className="min-w-0 flex-1" />
      </nav>
      {children}
    </div>
  );
}
