/** Hermes may not provide `structuredClone` in all environments. */
export function cloneJson<T>(value: T): T {
  const structuredCloneImpl = (
    globalThis as typeof globalThis & { structuredClone?: <U>(input: U) => U }
  ).structuredClone;
  if (typeof structuredCloneImpl === "function") {
    try {
      return structuredCloneImpl(value);
    } catch {
      // Fall back for values unsupported by structuredClone in this runtime.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
