import { defineConfig } from "tsdown";

export default defineConfig({
  banner: {
    dts: '/// <reference types="dom-chromium-ai" />\n/// <reference lib="esnext.disposable" />\n',
  },
  sourcemap: true,
  target: "es2025",
});
