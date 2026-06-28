import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("sidepanel HTML", () => {
  it("declares extension icon favicons for browser UI surfaces", () => {
    const html = readFileSync(resolve(__dirname, "../sidepanel.html"), "utf8");

    expect(html).toContain(
      '<link rel="icon" type="image/png" sizes="32x32" href="/icons/localhost-control-32.png" />',
    );
    expect(html).toContain(
      '<link rel="icon" type="image/png" sizes="128x128" href="/icons/localhost-control-128.png" />',
    );
  });
});
