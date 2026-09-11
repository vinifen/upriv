import { describe, expect, it } from "vitest";
import { sectionMatchesQuery } from "../search";

const t = (key: string) => {
  if (key.includes("overview")) return "Visão geral / Overview";
  if (key.includes("security")) return "Argon2id e conteúdo cifrado";
  return key;
};

describe("sectionMatchesQuery", () => {
  it("matches empty query to every section", () => {
    expect(sectionMatchesQuery("overview", "  ", t)).toBe(true);
  });

  it("matches diacritics after NFD fold", () => {
    expect(sectionMatchesQuery("overview", "visao", t)).toBe(true);
    expect(sectionMatchesQuery("security", "argon2id", t)).toBe(true);
    expect(sectionMatchesQuery("overview", "argon2id", t)).toBe(false);
  });
});
