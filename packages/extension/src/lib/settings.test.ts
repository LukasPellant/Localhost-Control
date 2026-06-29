import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings } from "./settings";

afterEach(() => {
  window.localStorage.clear();
  Reflect.deleteProperty(globalThis, "chrome");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("loadSettings", () => {
  it("falls back to defaults when localStorage contains invalid JSON", async () => {
    window.localStorage.setItem("localhost-control-settings", "{invalid-json");

    await expect(loadSettings()).resolves.toEqual(defaultSettings);
  });
});
