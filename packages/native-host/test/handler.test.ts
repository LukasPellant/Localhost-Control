import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/handler";

describe("handleRequest", () => {
  it("reports the native host package version for diagnostics", async () => {
    await expect(handleRequest({ id: "version-1", method: "version" })).resolves.toMatchObject({
      version: "0.1.2",
      platform: process.platform
    });
  });
});
