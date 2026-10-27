import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiUrl, csp } from "../vite.shared";

/**
 * Dasbor ABiTA untuk Admin SDM & Kepala Unit di /admin (bukan PWA).
 * Rute = file di src/routes (TanStack Router, file-based): src/routes/_app/staff/$id.tsx -> /admin/staff/12.
 * Disajikan oleh ../server.mjs. URL backend dan CSP diatur di ../vite.shared.ts.
 */
const dir = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const api = apiUrl(mode);
  return {
    root: dir,
    base: "/admin/",
    envDir: path.resolve(dir, ".."),
    define: { __API_URL__: JSON.stringify(api) },
    clearScreen: false,
    resolve: { alias: { "@": path.join(dir, "src") } },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: path.join(dir, "src", "routes"),
        generatedRouteTree: path.join(dir, "src", "routeTree.gen.ts"),
        quoteStyle: "double",
      }),
      react(),
      tailwindcss(),
      csp(api),
    ],
    build: { outDir: path.resolve(dir, "..", "dist", "admin"), emptyOutDir: true },
  };
});
