# @shayc/react-built-in-ai

## 0.3.3

### Patch Changes

- 61fe010: Docs: clarify the `idle` lifecycle state (it also covers the availability probe and auto-advances to `ready` for an already-downloaded model), fix the Surface section that implied `proofread` streams, and tighten README wording. No code changes — this republishes the npm registry README.
- 9be61e2: Resolve the built-in AI namespace inside the lifecycle store instead of the React hook. `useLifecycle` now passes only the API name down and no longer reads `globalThis` during render; the store resolves the namespace itself (live, per epoch) for the availability probe.

  No public API or behavior change — an internal cleanup that removes the cached namespace, a `start` parameter, and a dead guard, and keeps namespace resolution out of the React layer.

## 0.3.2

### Patch Changes

- eb44dac: Fix `acquire()` rejecting with a raw, untyped `Error` ("Unexpected lifecycle state") when called after the hook unmounts mid-download. It now rejects with a typed `AbortError`, consistent with every other teardown/abort path.

  Internally, the lifecycle store is modeled as a discriminated-union state machine, so a `ready` state owns its instance by construction — eliminating the desync between `status` and the live instance that produced the raw throw.

## 0.3.1

### Patch Changes

- 4529325: Docs: polish the README — collapse the redundant Surface table column into a single linked "Browser API" column, tighten the Requirements table, normalize "Built-in AI" capitalization, rename the "Options" section to "Option changes", and simplify the Usage example's button label to key off the `downloading` state.

## 0.3.0

### Minor Changes

- 7f28696: Add the remaining Built-in AI task APIs: `useSummarizer`/`createSummarizer`, `useWriter`/`createWriter`, and `useLanguageDetector`/`createLanguageDetector`. Summarizer and Writer expose the same `summarize`/`write` + streaming + `measureInput`/`inputQuota` surface as the existing hooks; `useLanguageDetector.detect` resolves with the browser's ranked `LanguageDetectionResult[]` and has no streaming variant. `isSupported` and `useGlobalDownloadProgress` now accept the three new namespace names.
- 7f28696: `useGlobalDownloadProgress` now returns `number | null` — `null` when nothing is downloading, instead of `0`. This lets callers distinguish "no download in flight" from "download just started at 0%". Update guards from `progress === 0` to `progress === null`.

## 0.2.2

### Patch Changes

- 082f9cd: Docs: overhaul README structure and badges, and clarify the imperative creators' error contract (typed `BuiltInAIError` lifecycle errors vs. browser rejections that pass through unchanged).

## 0.2.1

### Patch Changes

- 1fda8c3: Broaden the supported Node engine to `>=22`. The published package runs in the browser and has no Node-24-only requirements, so Node 22 (LTS) consumers no longer get an `EBADENGINE` warning on install. Verified against a Node 22/24 CI matrix.

## 0.2.0

### Minor Changes

- 00dd76f: Fix consumer-facing TypeScript resolution and tighten the build:
  - **Ambient types resolve automatically.** `@types/dom-chromium-ai` is now a regular dependency (was an optional peer), and the bundled `dist/index.d.mts` carries `/// <reference types="dom-chromium-ai" />` and `/// <reference lib="esnext.disposable" />` directives. Consumers on TypeScript 6+ no longer need to install the types package or enable `esnext.disposable` in their `lib` to use `useTranslator`/`useRewriter`/`useProofreader`. (Fixes the ~13 `Cannot find name 'Translator' | 'AsyncDisposable' | ...` errors a default-configured consumer hit before.)
  - **Node 24 required.** `engines.node` bumped from `>=20.19` to `>=24`; CI matrix collapsed to a single Node 24 job; CONTRIBUTING updated.
  - **tsdown target bumped to `es2025`** to match the `tsconfig.json` baseline.
  - Dropped the no-op `deps.neverBundle` block in `tsdown.config.ts`.
