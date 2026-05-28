# @shayc/react-built-in-ai

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
