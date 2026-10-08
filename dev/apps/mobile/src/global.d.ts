declare module "*.json" {
  const value: Record<string, string>;
  export default value;
}

/** Metro asset id for `Image` `source`. */
declare module "*.png" {
  const value: number;
  export default value;
}
