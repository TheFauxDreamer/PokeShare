import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../${name}/src`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pokeshare/data": pkg("data"),
      "@pokeshare/gba": pkg("gba"),
      "@pokeshare/shared": pkg("shared"),
    },
  },
  server: {
    port: 5173,
    // The mGBA core is threaded, so it needs SharedArrayBuffer, which is only
    // available under cross-origin isolation. Without these two headers the
    // emulator will not start at all -- and production must send them too.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
