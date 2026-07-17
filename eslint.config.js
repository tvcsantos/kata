import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/out/**", "packages/docs/.vitepress/cache/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The app renderer runs in the browser sandbox (window, document, ...).
  {
    files: ["packages/app/src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { window: "readonly", document: "readonly", console: "readonly" },
    },
  },
  // Type-aware rules for package sources only: each package's tsconfig
  // includes just src/, so tests and config files stay on the fast rules.
  {
    files: ["packages/*/src/**/*.ts", "packages/adapters/*/src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Adapters implement the async `Adapter` interface; several emit()
      // bodies are currently synchronous and that's fine.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    rules: {
      // The codebase deliberately narrows unknown/JSON shapes with casts.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
