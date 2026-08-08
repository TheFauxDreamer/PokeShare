import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src`, import.meta.url));

export default defineConfig({
  resolve: {
    // Map workspace packages straight at source so tests need no build step.
    alias: {
      "@pokeshare/data": pkg("data"),
      "@pokeshare/gba": pkg("gba"),
      "@pokeshare/shared": pkg("shared"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
