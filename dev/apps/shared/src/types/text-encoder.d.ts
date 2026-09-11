/**
 * `TextEncoder` is a runtime global in Node, browsers and Hermes, but this
 * package keeps `lib` DOM-free so it stays usable from React Native. Declaring
 * the one member we use avoids hand-rolling UTF-8 encoding.
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
