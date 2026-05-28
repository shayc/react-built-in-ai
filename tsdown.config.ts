import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  target: "es2025",
  dts: true,
  sourcemap: true,
  banner: {
    dts: '/// <reference types="dom-chromium-ai" />\n/// <reference lib="esnext.disposable" />\n',
  },
  publint: { enabled: "ci-only", strict: true, level: "error" },
});
