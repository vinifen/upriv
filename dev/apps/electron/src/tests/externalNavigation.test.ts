import { describe, expect, it } from "vitest";
import { externalNavigationUrl } from "../externalNavigation";

describe("externalNavigationUrl", () => {
  it("allows http, https, and mailto", () => {
    expect(externalNavigationUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(externalNavigationUrl("http://localhost")).toBe("http://localhost/");
    expect(externalNavigationUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("rejects scripts, files, and credential URLs", () => {
    expect(externalNavigationUrl("javascript:alert(1)")).toBeNull();
    expect(externalNavigationUrl("data:text/html,hi")).toBeNull();
    expect(externalNavigationUrl("file:///etc/passwd")).toBeNull();
    expect(externalNavigationUrl("https://user:pw@example.com")).toBeNull();
    expect(externalNavigationUrl("https://example.com/a\\b")).toBeNull();
    expect(externalNavigationUrl("https://example.com/a b")).toBeNull();
    expect(externalNavigationUrl("https://example.com/a\nb")).toBeNull();
    expect(externalNavigationUrl("https://example.com/\u0000x")).toBeNull();
  });
});
