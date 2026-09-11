import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import es from "../../../locales/es.json";
import ptBR from "../../../locales/pt-BR.json";

function sortedKeys(value: Record<string, string>): string[] {
  return Object.keys(value).sort();
}

describe("locale key parity", () => {
  it("keeps en, pt-BR, and es with identical key sets", () => {
    const enKeys = sortedKeys(en);
    expect(sortedKeys(ptBR)).toEqual(enKeys);
    expect(sortedKeys(es)).toEqual(enKeys);
  });
});
