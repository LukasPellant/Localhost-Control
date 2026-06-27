import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@localhost-control/shared": resolve(root, "../shared/src/index.ts")
    }
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, "sidepanel.html"),
        background: resolve(root, "src/background.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
