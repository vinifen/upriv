/// <reference types="vite/client" />

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "@i18n/*.json" {
  const value: Record<string, string>;
  export default value;
}
