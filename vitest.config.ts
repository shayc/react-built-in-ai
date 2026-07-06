import { playwright } from "@vitest/browser-playwright";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Test-only fakes and the pure re-export barrel carry no logic to
        // cover; counting them would only dilute the signal.
        "src/internal/testing/**",
        "src/index.ts",
      ],
      // Mirrors the @shayc/open-board-format sibling package's floors, which
      // catch real regressions with margin for V8 branch-counting variance.
      // functions is 95 rather than that package's 100 because a few defensive
      // `.catch(() => undefined)` handlers here are untestable without
      // contrivance; actuals sit ~96 stmts / ~90 branch / ~97 funcs / ~96 lines.
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 95,
        lines: 95,
      },
    },
  },
});
