import { afterEach, describe, expect, it } from "vitest";
import { shouldUseMockClient } from "./hostClient";

const originalUrl = window.location.href;

afterEach(() => {
  window.history.replaceState(null, "", originalUrl);
  Reflect.deleteProperty(globalThis, "chrome");
});

describe("shouldUseMockClient", () => {
  it("keeps demo data disabled in production builds", () => {
    window.history.replaceState(null, "", "/sidepanel.html?mock=1");

    expect(shouldUseMockClient(false)).toBe(false);
  });

  it("allows demo data only during development", () => {
    window.history.replaceState(null, "", "/sidepanel.html?mock=1");

    expect(shouldUseMockClient(true)).toBe(true);
  });
});
