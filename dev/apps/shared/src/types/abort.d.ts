/**
 * Abort APIs exist in Node, browsers and Hermes, but this package keeps `lib`
 * DOM-free so it stays usable from React Native. Vitest/Rollup also stub an
 * empty global `AbortSignal` — declare the members we use so `signal.aborted`
 * type-checks.
 */
interface AbortSignal {
  readonly aborted: boolean;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
