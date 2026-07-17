# @shayc/react-built-in-ai

## 0.11.3

### Patch Changes

- 860a0dd: README and docs refresh: outcome-first intro with feature bullets and extra badges (downloads, size, types), corrected Prompt API examples so the first click can authorize the model download (README + `useLanguageModel` JSDoc), fixed the `prompt-api-polyfill` link, added an error/retry branch to the lifecycle UI example, clarified the gate and security wording, lint-safe compaction recipe, absolute GitHub URLs for npm rendering, and a sharper package description.

## 0.11.2

### Patch Changes

- 98260d4: Fix `raceAbort` masking non-Error rejections as `AbortError` — a rejection with a non-Error reason (e.g. a rejected string) was coerced through the same path used for abort reasons, so genuine rejections were misreported as cancellations.

## 0.11.1

### Patch Changes

- 17cde10: Mention the Prompt API (`LanguageModel`) in the package description and keywords — it shipped in 0.11 but the npm metadata still listed only the six task APIs.

## 0.11.0

### Minor Changes

- ae3b224: Add Prompt API (`LanguageModel`) support: the `useLanguageModel` hook and `createLanguageModel` creator, with `LanguageModelOptions`, `PromptCallOptions`, `LanguageModelHookReturn`, and `CreateLanguageModelOptions` types exported. `"LanguageModel"` is now a `BuiltInAIName`, so `isSupported`, `checkAvailability`, and `useGlobalDownloadProgress` cover it too.

  Unlike the six stateless task hooks, `useLanguageModel` owns a private session per mount (conversations stay isolated; equal options never share an instance), captures its options at mount rather than re-keying on every render, and exposes session state: `prompt` / `promptStream` / `append` / `measureContext`, live `contextUsage` and `contextWindow`, an `overflowCount` counter for the session-compacting pattern, and `reset(nextOptions?)` to discard the conversation and provision a fresh session. The model download is still deduplicated by the browser across sessions. The raw `topK` / `temperature` sampling params are omitted from the option type (origin-trial / extension-gated and mid-redesign on the web surface).

  The Prompt API ships on Chrome 148+ (web) — a later floor than the other six APIs' 138+ — or via the official `prompt-api-polyfill`.

- ff76478: `checkAvailability()` is now typed per-API instead of accepting any `object`: options are required for `"Translator"` (matching the platform, which needs a language pair to answer meaningfully) and, for every name, must match that API's real `availability()` shape (its `*CreateCoreOptions`) rather than accepting arbitrary or cross-API option bags. `create()`-only members like `sharedContext` are correctly rejected too, since `availability()` never consumed them.

  This is breaking for types only, and fixes a real bug: `checkAvailability("Translator")` previously compiled but threw a `TypeError` at runtime. Callers iterating `BuiltInAIName` option-free for a capability list should use `isSupported("Translator")` for the existence check, or supply a language pair to probe real availability. The new `AvailabilityOptionsMap` and `BuiltInAIAvailability` types are exported for anyone building a generic wrapper.

## 0.10.0

### Minor Changes

- 264751e: - A hook that probes availability and finds a download already in flight elsewhere (another hook with different options, another tab, an imperative `create*` call) now reports `status: "downloading"` and joins it — gesture-free, no `MissingUserActivationError` — instead of collapsing to `"downloadable"` and staying stuck there after the download completes. This fixes stale "download required" UI for a passively-observing component while the model is actually mid-download or already finished.
  - `progress` is `null` while `status === "downloading"` until the browser actually reports a fraction via a `downloadprogress` event — it no longer fabricates a starting `0`. This applies to every download, not just joined ones: a hook-driven download you triggered yourself now also starts at `null` and moves to a number only once the browser says so. `useGlobalDownloadProgress()`'s aggregate is unaffected — it coalesces an in-flight download with no signal yet to `0`.
  - Imperative `create*` factories (`createTranslator`, `createRewriter`, etc.) no longer throw `MissingUserActivationError` when called without a gesture while a download is already in flight — they join it, same as a hook. A gesture is still required to _start_ a download.

## 0.9.0

### Minor Changes

- 2f39bf5: Add `checkAvailability(name, options?)` — a lightweight readiness probe that returns the browser's own `availability()` result (`"available" | "downloadable" | "downloading" | "unavailable"`) without mounting a hook or creating an instance. Useful for a capability list or settings screen that needs a real status for options the user hasn't committed to yet. Throws `UnsupportedError` when the namespace global is absent.
- 208801d: Actions and `prepare()` now recover from a parked `downloadable` state without a user gesture once the model is already on-device elsewhere (another component, another tab) — previously they'd throw `MissingUserActivationError` even though no download was actually needed anymore.

  - A gesture-less call from `downloadable` re-probes availability once; if the model turns out to already be available, it provisions quietly and reaches `ready`. If it's still genuinely downloadable, the call throws `MissingUserActivationError` as before (bounded to one extra probe — no spinning).
  - Mid-flight lifecycle resets (a `prepare()` retry, or a same-key restart racing an in-progress `acquire()`) now reject with a `DOMException` named `AbortError` instead of `NotReadyError`, since the request was cancelled rather than failed — filter it the same way you'd filter any other abort (`error.name === "AbortError"`).
  - `NotReadyError`'s message is corrected to describe its narrowed remaining meaning: a prior `create()` rejected; inspect `.cause` for the underlying rejection.

- 208801d: - `progress` is now `number | null` instead of always `number` — `null` when no download is in flight, `0..1` while downloading. Previously it was `0` both before a download started and while idle, indistinguishable from "just started." Consumers computing `progress * 100` will get a type error pointing at exactly the spot that needs a `?? 0` or a `progress === null` check.
  - The `"idle"` status is renamed to `"checking"`. It always meant "probing availability, or quietly creating an already-downloaded model" — the old name read as "nothing happening," which it isn't. Exhaustive `switch` statements over `Status` (including the `satisfies never` pattern) will get a compile error at every site that needs updating.
  - Dropped `engines` from the published `package.json`; the Node version requirement is enforced in CI, not at install time.
- 208801d: Hooks with equal options — same namespace, same options by value — now share one underlying model instance and one `status`/`progress`/`error`, instead of each hook call creating its own private instance. The instance is created on the first mount that needs it and torn down when the last component using those options unmounts; a `prepare()` retry from `error` restarts the shared instance for every component using it, not just the caller. See the new "Instance sharing" section in the README.

  Also: `{ foo: undefined }` and omitting `foo` are now treated as the same options for sharing/re-render purposes (option-key comparison drops undefined-valued properties, matching `JSON.stringify`).

  **Note for test suites**: if your tests assert per-hook `create()` call counts, components sharing equal options will now produce fewer `create()` calls than before — update the counts, not the behavior.

## 0.8.1

### Patch Changes

- aab7c13: Update `@types/dom-chromium-ai` to `^0.0.17`.
- e96e9bd: Lifecycle and streaming fixes:

  - Inline array-valued options (e.g. `expectedInputLanguages: ["en"]`) no longer crash with "Too many re-renders" — option arrays are compared element-wise.
  - Hooks no longer throw during SSR: both `useSyncExternalStore` call sites now provide a server snapshot (idle lifecycle, `null` download progress), with clean hydration.
  - Exiting a streaming loop early (`break`/`throw`) now cancels the underlying stream instead of leaving the model generating into an abandoned reader.
  - Per-call options are forwarded to the browser APIs wholesale (`{ ...opts, signal }`), so future upstream option fields flow through instead of being dropped.

## 0.8.0

### Minor Changes

- 844f0fd: Add a `downloadable` lifecycle status. The hook previously parked in `idle` when the model needed a download, indistinguishable from a probe still in flight — consumers had to re-call `availability()` themselves to know when to render a download affordance. `checkAvailability` now surfaces what it learns: `idle` is strictly "probing availability", and `downloadable` means the model awaits the user gesture Chrome requires before a fetch. `prepare()` (or any action method) called from a user activation moves it through `downloading` to `ready`, exactly as before.

  Breaking for exhaustive `switch`es over `Status` (they'll get a compile error pointing at the new state) and for any code that treated a settled `idle` as "download required" — that state is now named.

## 0.7.0

### Minor Changes

- f5e8554: `useGlobalDownloadProgress` now aggregates with min instead of max: it reports the least-complete in-flight download, so the value never moves backwards when one of several concurrent downloads finishes. It also accepts an array to scope aggregation to multiple namespaces: `useGlobalDownloadProgress(["Proofreader", "Rewriter"])`. Single-namespace, explicit-`undefined`, and no-argument calls keep working unchanged; only the aggregated value differs when more than one download is in flight.

## 0.6.0

### Minor Changes

- 7dc4790: Restore the ergonomic `prepare()` and remove `retry()`.

  Reverts the prepare/retry split from the previous release. `prepare()` once again recovers from `error` state — it tears down the failed instance, re-initializes from the current options, and warms up — so a single method drives the model to `ready` from any state. The separate `retry()` introduced last release is removed; call `prepare()` to recover instead.

  The `MissingUserActivationError` message is also sharpened: it now frames a click/keypress as examples of a transient user activation (not the rule), says to call `prepare()` or the action directly inside such a handler, and names the real traps — effects, timers, page load, and post-`await` activation expiry.

## 0.5.0

### Minor Changes

- 2353923: Add `retry()` and make `prepare()` warm-up-only; sharpen the user-activation error.
  - **New `retry()` on every hook.** Recovers from a failed lifecycle by tearing down the errored instance, re-initializing from the current options, and warming up. This is the explicit recovery path that used to be a side effect of `prepare()`.
  - **`prepare()` is now warm-up only.** From `error` state it rejects with `NotReadyError` instead of silently resetting and re-initializing. Call `retry()` to recover. From any non-`error` state, `prepare()` and `retry()` behave identically.
  - **`MissingUserActivationError` now explains the fix** — its message points at calling `prepare()` (or the action) from a click/keypress handler, so the failure is self-explaining when it surfaces from an effect or timer on a first-time (uncached) user.

## 0.4.0

### Minor Changes

- 98aba7b: Rename the `NoUserActivationError` class to `MissingUserActivationError`. The new name keeps the "missing thing" meaning while aligning with its sibling adjective-style names (`UnsupportedError`, `UnavailableError`).

  **Breaking:** update any `import`, `instanceof`, or `catch` checks that reference `NoUserActivationError`.

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
