import { defineConfig } from "vitest/config";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "ForgeEditor",
      fileName: "forge.editor",
      formats: ["es"],
    },
  },
  plugins: [dts({ include: ["src"], entryRoot: "src" })],
  test: {
    environment: "jsdom",
  },
});
