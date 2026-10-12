import { Fragment, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { breadcrumbShrink, pathBreadcrumbs } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

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
  const { colors } = useTheme();
  const crumbs = pathBreadcrumbs(vaultName, path);
  const last = crumbs.length - 1;

  return (
    <View style={[styles.bar, { backgroundColor: colors.surfaceContainerHigh }]}>
      {/* flex-end + trailing spacer: left-aligned when it fits; if it still overflows, the start is clipped. */}
      <View
        style={styles.crumbs}
        accessible
        accessibilityLabel={`${t("modal.file_manager.viewer.path_label")}: ${crumbs.join(" › ")}`}
      >
        {crumbs.map((name, index) => (
          <Fragment key={`${index}-${name}`}>
            {index > 0 ? (
              <View style={styles.chevron}>
                <Icon name="chevron-right" size={10} color={colors.onSurfaceVariant} />
              </View>
            ) : null}
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.crumb,
                index === last ? styles.lastCrumb : null,
                {
                  flexShrink: breadcrumbShrink(index, crumbs.length),
                  color: index === last ? colors.onSurface : colors.onSurfaceVariant,
                },
              ]}
            >
              {name}
            </Text>
          </Fragment>
        ))}
        <View style={styles.spacer} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 24,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 4,
  },
  crumbs: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  crumb: { fontSize: 12, maxWidth: 160, minWidth: 20 },
  lastCrumb: { minWidth: 32 },
  chevron: { marginHorizontal: 2, flexShrink: 0, opacity: 0.7 },
  spacer: { flexGrow: 1, flexShrink: 0, minWidth: 0 },
});
