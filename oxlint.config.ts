import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "oxc", "react"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: "error",
  },
  env: {
    browser: true,
  },
  ignorePatterns: ["dist/**", "coverage/**"],
  rules: {
    "react/rules-of-hooks": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/only-throw-error": "error",
  },
});
