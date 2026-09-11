/** Hermes (React Native) does not always provide `structuredClone`. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
