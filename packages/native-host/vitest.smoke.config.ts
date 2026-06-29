import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    include: ["test/**/*.smoke.ts"]
  }
});
