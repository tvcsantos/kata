import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// The @katahq/core version the app ships with, injected at build time so the
// About screen never has to resolve a package.json at runtime.
const require = createRequire(import.meta.url);
const coreVersion = (require("@katahq/core/package.json") as { version: string }).version;

/**
 * Main and preload keep their dependencies external; electron-builder packs
 * the production dependencies into the app bundle at package time.
 */
export default defineConfig({
  main: {
    build: { externalizeDeps: true },
    define: {
      __CORE_VERSION__: JSON.stringify(coreVersion),
    },
  },
  preload: {
    build: { externalizeDeps: true },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      // The monorepo carries two react majors (vitepress pulls 18 into the
      // root, where react-markdown gets hoisted). Force every react import
      // in the bundle onto the app's own copy - two runtimes make
      // react-markdown's elements foreign objects that crash the render.
      dedupe: ["react", "react-dom"],
    },
  },
});
