import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  dts: true,
  banner: {
    dts: '/// <reference types="dom-chromium-ai" />\n/// <reference lib="esnext.disposable" />\n',
  },
  sourcemap: true,
  target: "es2025",
  clean: true,
});
