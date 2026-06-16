/// <reference types="vite/client" />

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "@upriv/shared/locales/*.json" {
  const value: Record<string, string>;
  export default value;
}

declare module "../../locales/*.json" {
  const value: Record<string, string>;
  export default value;
}
