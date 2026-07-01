import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: process.platform === "win32" ? ["test/**/*.test.ts"] : ["test/**/*.test.ts", "test/**/*.test.mjs"]
  }
});
