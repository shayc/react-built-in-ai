# `@shayc/react-built-in-ai`

[![npm version](https://img.shields.io/npm/v/@shayc/react-built-in-ai.svg)](https://www.npmjs.com/package/@shayc/react-built-in-ai)
[![CI](https://github.com/shayc/react-built-in-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/shayc/react-built-in-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@shayc/react-built-in-ai.svg)](LICENSE)

A thin React layer over the browser's [Built-in AI](https://developer.chrome.com/docs/ai/built-in) APIs — models the browser downloads and runs on-device. Six task APIs, each with a React hook and an imperative creator, all sharing one lifecycle state machine. TypeScript-first, with option and return types exported for every API.

**Browser support** — Chromium only (Chrome 138+, Edge); not Firefox or Safari. The Built-in AI globals are gated by Chrome flags / origin trial and absent on unsupported builds — feature-detect with [`isSupported()`](#capability-check) and render a fallback.

## Install

```bash
npm install @shayc/react-built-in-ai
```

## Quick start

```tsx
import { useTranslator } from "@shayc/react-built-in-ai";

function Translate() {
  const translator = useTranslator({
    sourceLanguage: "en",
    targetLanguage: "es",
  });

  return (
    <button
      disabled={translator.status === "downloading"}
      onClick={async () => alert(await translator.translate("Hello, world."))}
    >
      Translate
    </button>
  );
}
```

On a fresh browser, the first click triggers the model download (gated by user activation); subsequent clicks call `translate` directly. See [Lifecycle](#lifecycle) for the full state machine.

## Surface

| Browser API                                                                  | React hook            | Imperative creator       |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------ |
| [Translator](https://developer.chrome.com/docs/ai/translator-api)            | `useTranslator`       | `createTranslator`       |
| [Rewriter](https://developer.chrome.com/docs/ai/rewriter-api)                | `useRewriter`         | `createRewriter`         |
| [Proofreader](https://developer.chrome.com/docs/ai/proofreader-api)          | `useProofreader`      | `createProofreader`      |
| [Summarizer](https://developer.chrome.com/docs/ai/summarizer-api)            | `useSummarizer`       | `createSummarizer`       |
| [Writer](https://developer.chrome.com/docs/ai/writer-api)                    | `useWriter`           | `createWriter`           |
| [Language Detector](https://developer.chrome.com/docs/ai/language-detection) | `useLanguageDetector` | `createLanguageDetector` |

**Use the hook** when options are known at render time (e.g. a translator bound to the user's current language pair). **Use the creator** when options are decided mid-flow and a hook can't be driven (queued work, command palettes, one-shot scripts).

Every hook shares the lifecycle surface plus task-specific methods (`translate`, `rewrite`, `proofread`, `summarize`, `write`, `detect`), along with streaming and `measureInput` variants where the underlying API supports them. Two exceptions:

- `useProofreader` exposes only `proofread` — the browser API offers no streaming, `measureInput`, or `inputQuota`.
- `useLanguageDetector` has no streaming variant, and its `detect` resolves with an array of ranked `{ detectedLanguage, confidence }` candidates rather than a string.

## Requirements

| Requirement   | Version                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| React         | 18.x or 19.x (peer dependency)                                           |
| Browser       | Chromium with Built-in AI globals — Chrome 138+, Edge                    |
| Runtime       | Client-only — add `"use client"` in RSC setups (e.g. Next.js app router) |
| Module format | ESM only                                                                 |

## Capability check

Feature-detect before mounting any hook:

```tsx
import { isSupported } from "@shayc/react-built-in-ai";

if (!isSupported("Translator")) return <Fallback />;
```

`isSupported(name)` returns `true` when the matching global (`"Translator"`, `"Rewriter"`, `"Proofreader"`, `"Summarizer"`, `"Writer"`, `"LanguageDetector"`) is present on `globalThis`. Combine with the hook's `status` (`"unavailable"`) for the full readiness picture — the global can exist on a device that still can't run the model.

### Checking availability without a hook

`checkAvailability(name, options)` runs the same on-device readiness probe every hook and creator uses internally, without mounting a hook or creating an instance — useful for a capability list or settings screen that needs a real status for options the user hasn't committed to yet. Options are optional for every API except `"Translator"`, which needs a language pair to answer meaningfully:

```tsx
import { checkAvailability } from "@shayc/react-built-in-ai";

const availability = await checkAvailability("Translator", {
  sourceLanguage: "en",
  targetLanguage: "es",
});
// "available" | "downloadable" | "downloading" | "unavailable"
```

It throws `UnsupportedError` when the global is absent — check `isSupported()` first if you'd rather branch on that yourself. Unlike the hook's `status`, this is a one-shot probe: it doesn't stay in sync if availability changes afterward.

## Lifecycle

Every hook exposes `status`, `progress`, `error`, and `prepare`. `status` is always one of:

- **`unsupported`** — the global namespace is missing on this browser.
- **`unavailable`** — the model reports it cannot run on this device.
- **`checking`** — supported; probing availability, or quietly creating an already-downloaded model. Passes through to `ready` on its own.
- **`downloadable`** — the model needs a download, which the browser only starts from a **user activation**. Render your download affordance off this state; `prepare()` (or any action method) called from a user gesture moves it along. Mirrors the browser's `availability()` vocabulary. A gesture-less call re-checks once before failing, in case the model finished downloading — or is mid-download, in which case the download is joined — elsewhere (another component, another tab) since this hook last checked.
- **`downloading`** — a fetch is running, either started by this hook or joined passively (the browser already reported a download in flight when this hook probed — e.g. another hook with different options, another tab, or an imperative `create*` call). `progress` is a number only once the browser has reported a fraction via a `downloadprogress` event; otherwise it's `null` — no starting value is ever fabricated, so a joined download that's already partway done isn't misreported as `0`.
- **`ready`** — the instance is live; action methods can be called freely.
- **`error`** — `availability()` or `create()` rejected. Call `prepare()` (from a user activation if a download is required) to tear down and re-initialize.

### Instance sharing

Hooks with equal options — same namespace, same options by value — share one underlying model instance and one `status`/`progress`/`error`. The instance is created on the first mount that needs it and torn down when the last component using those options unmounts; everything in between (including a `prepare()` retry from `error`) is visible to every component sharing it. This means two components — say, a settings panel showing download status and a toolbar actually using the model — stay in sync automatically as long as they're called with the same options.

## Usage

Action methods are gated by the lifecycle — they throw `UnsupportedError`, `UnavailableError`, `MissingUserActivationError`, or `NotReadyError` when the state forbids them. **A call rejected by the gate never mutates the hook's `status` or `error`.** (A call made from `downloadable` with a user activation is not gate-rejected — it drives `status` through `downloading` to `ready` or `error` like `prepare()`.)

```tsx
function Demo() {
  const translator = useTranslator({
    sourceLanguage: "en",
    targetLanguage: "es",
  });

  // 1. Guard against browsers/devices that can't run the model.
  if (translator.status === "unsupported") return <p>Not supported.</p>;
  if (translator.status === "unavailable") return <p>Not available.</p>;

  return (
    <button
      // 2. Block re-entry while the model is downloading.
      disabled={translator.status === "downloading"}
      onClick={async () => {
        // 3. The click is a user activation, so the hook is allowed to start
        //    the download here if status was "downloadable"; otherwise it runs
        //    at once.
        const out = await translator.translate("…some text…");
        console.log(out);
      }}
    >
      {translator.status !== "downloading"
        ? "Translate"
        : translator.progress === null // null until the browser reports a fraction
          ? "Downloading…"
          : `Downloading (${Math.round(translator.progress * 100)}%)`}
    </button>
  );
}
```

Streaming — accumulate chunks into React state to render incrementally:

```tsx
const [output, setOutput] = useState("");

async function handleTranslate(text: string) {
  setOutput("");
  for await (const chunk of translator.translateStream(text)) {
    setOutput((prev) => prev + chunk);
  }
}
```

## Imperative creators

```ts
try {
  await using translator = await createTranslator({
    sourceLanguage,
    targetLanguage,
  });
  const text = await translator.translate(input);
} catch (error) {
  if (!(error instanceof BuiltInAIError)) throw error;
  // unsupported / unavailable / missing-activation — render a fallback.
}
```

Each `create*` mirrors the hook lifecycle exactly — same three typed errors (`UnsupportedError`, `UnavailableError`, `MissingUserActivationError`), same progress wiring. Unlike with the hooks, **other browser rejections surface unchanged** — most commonly `AbortError` when `signal` fires, or `NetworkError` on a failed download. The `instanceof BuiltInAIError` check above is what separates the typed lifecycle errors from those pass-throughs.

The returned instance is `AsyncDisposable` — prefer `await using` so it's released on scope exit. `.destroy()` is also exposed for callers that need to release earlier.

Each creator accepts the same options as its hook, plus an optional `signal` that cancels both the download (if any) and the underlying `create()` call.

A creator requires a user activation only to _start_ a download (`availability()` reporting `"downloadable"`) — prefer calling it from an event handler, or pre-warm the model via the matching hook elsewhere in the tree before the call site is reached. If a download is already in flight elsewhere (`"downloading"`), the creator joins it gesture-free, same as a hook that finds one on probe.

## Download progress

- **Per-instance** — read `progress` and `status` from the hook return, or from a creator's own thrown/awaited lifecycle.
- **Cross-instance** — `useGlobalDownloadProgress(namespaces?)` reports the progress of the least-complete in-flight download across every instance, regardless of which component (or imperative caller) initiated the download. The value never moves backwards when one of several downloads finishes, and returns to `null` once all of them complete — finished downloads stop being tracked, so key "done" off `null`, not `progress === 1`. Pass a namespace (`"Translator"`, `"Rewriter"`, `"Proofreader"`, `"Summarizer"`, `"Writer"`, `"LanguageDetector"`) or an array of namespaces to scope the aggregation, or call with no argument to track all Built-in AI downloads.

```tsx
function GlobalDownloadBar() {
  const progress = useGlobalDownloadProgress();
  if (progress === null) return null;
  return <ProgressBar value={progress} />;
}
```

## Option changes

Options are compared structurally — sorted and compared by content, not by reference — so inline object/array literals are safe without memoization: a fresh literal with the same content resolves to the same underlying instance.

When a component's options change, it re-enters the state machine. If it was the last component holding the old options, that instance is destroyed and its in-flight work aborted with `AbortError`; if another component still holds the old options, that instance keeps running for it — an option change never disturbs components still sharing the old instance.

## Errors

Lifecycle gating throws `BuiltInAIError` subclasses. Action methods (`translate`, `rewrite`, …) pass the browser API's own rejections through unchanged — most commonly an `AbortError` `DOMException` when a `signal` fires. When the lifecycle wraps a browser rejection into `"error"` state, the original error is preserved as `error.cause`.

| Error                        | What to do                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `UnsupportedError`           | The namespace is missing. Feature-detect with `isSupported()` and render a fallback.                                             |
| `UnavailableError`           | The device can't run the model. Render a fallback; don't retry.                                                                  |
| `MissingUserActivationError` | A download needed to be started without a user gesture. Trigger `prepare()` (or the first action) from a click/keypress handler. |
| `NotReadyError`              | A prior `create()` failed. Call `prepare()` from a user activation to retry; inspect `error.cause` for the underlying reason.    |

Components with equal options share one lifecycle: if another component sharing your options calls `prepare()` to retry from `"error"`, that restarts the shared store — any of your own in-flight action calls reject with a `DOMException` named `AbortError`. Filter it like any other cancellation (`error.name === "AbortError"`), not as a failure.

## Cancellation

A per-call `signal` cancels the _caller's_ wait and the underlying action call, but does not tear down the shared model instance. If the hook is mid-download, aborting one call rejects that call with `AbortError` while the download keeps running for any other caller (and for the next call from the same component). **The download is only cancelled when the last component sharing it unmounts (or changes options such that it's no longer the last holder).** A sibling component's `prepare()` retry can also abort your in-flight call — see Errors above.

## Security

No network calls — everything runs against the browser's on-device model. Releases are published to npm with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements) so the bytes you install can be traced back to a specific GitHub Actions run.

Found a security issue? Open a private advisory at [github.com/shayc/react-built-in-ai/security/advisories/new](https://github.com/shayc/react-built-in-ai/security/advisories/new).

## Versioning

Semver; see [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup (Node 22+, Vitest browser mode, the changeset workflow).

## License

[MIT](LICENSE) © Shay Cojocaru
