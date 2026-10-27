import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiUrl, csp } from "../vite.shared";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Aplikasi karyawan ABiTA di /staff (PWA, tampil seperti aplikasi HP, bisa dipasang ke layar utama).
 * Rute = file di src/routes (TanStack Router, file-based): src/routes/_auth/_tabs/dashboard.tsx -> /staff/dashboard.
 * Disajikan oleh ../server.mjs. URL backend dan CSP diatur di ../vite.shared.ts.
 */
const dir = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const api = apiUrl(mode);
  return {
    root: dir,
    base: "/staff/",
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
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
        includeAssets: ["abita-mark.svg", "icons/*.png", "manifest.webmanifest"],
        // manifest statis di public/manifest.webmanifest (ditautkan di index.html) agar ikut tersaji saat dev;
        // tanpa manifest, iPhone memasang ikon sebagai halaman Safari biasa (bar browser, mulai dari halaman saat dipasang)
        manifest: false,
        includeManifestIcons: false,
        workbox: {
          // model wajah & wasm besar: di-cache saat pertama dipakai, bukan saat instalasi
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          globIgnores: ["mediapipe/**"], // model & wasm wajah besar: di-cache saat pertama dipakai (runtimeCaching), bukan saat instal
          navigateFallback: "/staff/index.html",
          // notifikasi push (public/push-sw.js)
          importScripts: ["push-sw.js"],
          navigateFallbackDenylist: [/^\/api\//, /^\/admin/],
          runtimeCaching: [{ urlPattern: /\/staff\/mediapipe\//, handler: "CacheFirst", options: { cacheName: "abita-mediapipe", expiration: { maxEntries: 20 } } }],
        },
      }),
    ],
    build: { outDir: path.resolve(dir, "..", "dist", "staff"), emptyOutDir: true },
  };
});
