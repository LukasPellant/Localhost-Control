import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "LocalhostControl", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
