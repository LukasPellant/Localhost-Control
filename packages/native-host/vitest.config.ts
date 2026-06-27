import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@localhost-control/shared": resolve(root, "../shared/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
