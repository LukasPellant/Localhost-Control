import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(__dirname, "../.github/workflows/release-native-host.yml"), "utf8");

describe("release-native-host workflow", () => {
  it("checks out the requested release tag for manual dispatch builds", () => {
    const checkoutCount = (workflow.match(/uses: actions\/checkout@v4/g) ?? []).length;
    const pinnedRefCount = (workflow.match(/ref: \$\{\{ inputs\.tag \|\| github\.ref \}\}/g) ?? []).length;

    expect(checkoutCount).toBe(3);
    expect(pinnedRefCount).toBe(checkoutCount);
  });
});
