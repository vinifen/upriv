/** Node stand-in for `react-native`. Vitest cannot parse the package's Flow entry. */
export const Platform = {
  OS: "android",
  select<T>(specifics: { android?: T; ios?: T; default?: T }): T | undefined {
    if (specifics.android !== undefined) return specifics.android;
    return specifics.default;
  },
};
