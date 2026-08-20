import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plain Vite for the frontend ONLY. The Hono worker in server/ is built by the
// Railcode CLI (esbuild) for both `railcode dev` and `railcode deploy`.
export default defineConfig({
  root: "frontend",
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
