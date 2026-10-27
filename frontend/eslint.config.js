import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Lint untuk admin/ & staff/: TypeScript + aturan React Hooks (termasuk larangan setState di dalam effect).
export default tseslint.config(
  { ignores: ["dist/**", "**/routeTree.gen.ts"] },
  {
    files: ["admin/src/**/*.{ts,tsx}", "staff/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }], // try { localStorage... } catch {}
    },
  },
  {
    // Temuan lama di aplikasi karyawan (belum pernah di-lint): reset form saat sheet dibuka & ref di hook kamera.
    // Peringatan saja sampai dirapikan; perilaku kamera perlu diuji di HP sebelum diubah.
    files: ["staff/src/components/forms.tsx", "staff/src/lib/face/useVerifier.ts"],
    rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/refs": "warn" },
  },
);
