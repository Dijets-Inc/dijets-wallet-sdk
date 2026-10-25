import js from "@eslint/js"
import tseslint from "typescript-eslint"

// Lints the Dijets code. The vendored upstream source (src/upstream) and its
// tests keep upstream's style and are checked by the type checker and tests.
export default tseslint.config(
  { ignores: ["jest.config.js", "docs/**", "dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-constant-condition": ["error", { checkLoops: false }]
    }
  },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { console: "readonly", process: "readonly" } } }
)
