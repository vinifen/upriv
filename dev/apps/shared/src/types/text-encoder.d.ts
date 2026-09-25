/**
 * Encoding globals exist in Node, browsers and Hermes, but this package keeps
 * `lib` DOM-free so it stays usable from React Native. Declaring the members we
 * use avoids hand-rolling UTF-8 / Base64 conversion.
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

declare class TextDecoder {
  constructor(label?: string, options?: TextDecoderOptions);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

declare function atob(data: string): string;
declare function btoa(data: string): string;
