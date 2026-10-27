import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser talks to /api/*, and Vite forwards it to the booking API, so the API needs no CORS
// settings. Point SWIMSYNC_API at HAProxy (http://127.0.0.1:8080) to demo drill A through the UI.
const api = process.env.SWIMSYNC_API ?? "http://127.0.0.1:8001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
});
