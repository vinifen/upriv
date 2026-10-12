/**
 * WHATWG `URL` is available in the desktop renderer, Electron, and Hermes.
 * `@upriv/shared` does not pull in the DOM lib, so the constructor used by the
 * markdown link allowlist is declared here.
 */
interface MarkdownUrl {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly href: string;
}

declare const URL: {
  new (url: string): MarkdownUrl;
};
