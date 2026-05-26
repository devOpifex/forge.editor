import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "ForgeEditor",
      fileName: () => "forge.editor.iife.js",
      formats: ["iife"],
    },
    outDir: "r-package/inst/htmlwidgets/lib/forge.editor",
    emptyOutDir: true,
    sourcemap: false,
  },
});
