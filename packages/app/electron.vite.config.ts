import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
