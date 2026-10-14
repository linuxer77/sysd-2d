import { defineConfig, defaultClientConditions } from "vite";
import react from "@vitejs/plugin-react";

// `development` makes workspace packages resolve to their TypeScript source, so editing the
// simulator hot-reloads the browser with no build step. (Their production export points at dist/.)
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["development", ...defaultClientConditions] },
  server: { port: 5173 },
  build: { target: "es2022", sourcemap: true },
});
