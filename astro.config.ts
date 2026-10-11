import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: vercel(),
  integrations: [react()],
  vite: {
    // Astro check/sync/build optimize production React. Sharing those files with
    // a running dev server can replace jsxDEV with the production-only runtime.
    cacheDir: `node_modules/.vite/${process.env.NODE_ENV === "production" ? "production" : "development"}`,
    plugins: [tailwindcss()],
  },
});
