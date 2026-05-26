import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  external: ["react", "react/jsx-runtime"],
  dts: true,
  sourcemap: true,
  target: "es2024",
  clean: true,
});
