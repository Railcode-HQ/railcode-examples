import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Plain Vite for the frontend ONLY. The Hono worker in server/ is built by the
// Railcode CLI (esbuild) for both `railcode dev` and `railcode deploy`.
export default defineConfig({
  root: "frontend",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
      // The wire contract between the two halves of the app. Shared source, so
      // a change to a message shape is a compile error on BOTH sides at once.
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
