import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // `railcode dev` proxies the app on :7331 to this Vite server, but the proxy
    // can't upgrade Vite's HMR WebSocket (handshake returns 200, not 101). Vite
    // then ping-reloads the page in a loop. Disabling HMR keeps the dev page
    // stable; refresh manually after edits. No effect on `vite build`/deploy.
    hmr: false,
  },
});
