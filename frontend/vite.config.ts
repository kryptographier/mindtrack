/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this app from https://<user>.github.io/<repo>/,
// not from the domain root. VITE_BASE_PATH must be set to "/<repo>/"
// in the GitHub Actions build step (see .github/workflows/deploy.yml,
// Phase 8). Defaults to "/" for local development.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    outDir: "dist",
    sourcemap: false, // avoid shipping source maps for a private-data app
  },
  test: {
    environment: "jsdom",
  },
});
