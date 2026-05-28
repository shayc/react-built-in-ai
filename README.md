# `@shayc/react-built-in-ai`

A thin React layer over the browser's [Built-in AI](https://developer.chrome.com/docs/ai/built-in) APIs — Gemini Nano on Chrome, Phi 4 Mini on Edge. Six task APIs, each with a React hook and an imperative creator, all sharing one lifecycle state machine.

[![npm version](https://img.shields.io/npm/v/@shayc/react-built-in-ai.svg)](https://www.npmjs.com/package/@shayc/react-built-in-ai)
[![CI](https://github.com/shayc/react-built-in-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/shayc/react-built-in-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@shayc/react-built-in-ai.svg)](LICENSE)

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

The first click on a fresh browser triggers the model download (gated by user activation); subsequent clicks call `translate` directly. See [Lifecycle](#lifecycle) for the full state machine.

## Features

- **First-class TypeScript** — full `.d.mts` types and a `BuiltInAIError` hierarchy (`UnsupportedError`, `UnavailableError`, `NoUserActivationError`, `NotReadyError`) for narrow `catch` clauses.
- **`AsyncDisposable` instances** — use `await using` for automatic teardown; `.destroy()` stays exposed for callers that need to release earlier.
- **Cross-instance download progress** — `useGlobalDownloadProgress()` aggregates in-flight downloads across every hook and creator for a single global progress UI.

## Surface

| Browser API                                                                  | React hook            | Imperative creator       |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------ |
| [Translator](https://developer.chrome.com/docs/ai/translator-api)            | `useTranslator`       | `createTranslator`       |
| [Rewriter](https://developer.chrome.com/docs/ai/rewriter-api)                | `useRewriter`         | `createRewriter`         |
| [Proofreader](https://developer.chrome.com/docs/ai/proofreader-api)          | `useProofreader`      | `createProofreader`      |
| [Summarizer](https://developer.chrome.com/docs/ai/summarizer-api)            | `useSummarizer`       | `createSummarizer`       |
| [Writer](https://developer.chrome.com/docs/ai/writer-api)                    | `useWriter`           | `createWriter`           |
| [Language Detector](https://developer.chrome.com/docs/ai/language-detection) | `useLanguageDetector` | `createLanguageDetector` |

**Use the hook** when the options are known at render time (e.g. a translator bound to the user's current language pair). **Use the creator** when options are decided mid-flow and a hook can't be driven (queued work, command palettes, one-shot scripts).

Every hook shares the lifecycle surface plus task-specific methods (`translate`, `rewrite`, `proofread`, `summarize`, `write`, `detect`, plus streaming and `measureInput` variants where the underlying API supports them). Two exceptions: `useProofreader` omits `measureInput`/`inputQuota` (the browser API exposes neither), and `useLanguageDetector` has no streaming variant — its `detect` resolves with an array of ranked `{ detectedLanguage, confidence }` candidates rather than a string.

## Requirements

| Requirement   | Version                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| React         | 18.x or 19.x (peer dependency)                                           |
| Browser       | Chromium with Built-in AI globals — Chrome 138+, Edge                    |
| Runtime       | Client-only — add `"use client"` in RSC setups (e.g. Next.js app router) |
| Module format | ESM only                                                                 |
| Node          | 22+ for development (runtime is the browser)                             |

## Capability check

The Built-in AI globals are gated by Chrome flags / origin trial and only present on supported builds. Feature-detect before mounting any hook:

```tsx
import { isSupported } from "@shayc/react-built-in-ai";

if (!isSupported("Translator")) return <Fallback />;
```

`isSupported(name)` returns `true` when the matching global (`"Translator"`, `"Rewriter"`, `"Proofreader"`, `"Summarizer"`, `"Writer"`, `"LanguageDetector"`) is present on `globalThis`. Combine with the hook's `status` (`"unavailable"`) for the full readiness picture — the global can exist on a device that still can't run the model.

## Lifecycle

Every hook exposes `status`, `progress`, `error`, and `prepare`. `status` is always one of:

- **`unsupported`** — the global namespace is missing on this browser.
- **`unavailable`** — the model reports it cannot run on this device.
- **`idle`** — supported, but a download is required before use.
- **`downloading`** — entered via **`prepare()`** (or any action method) called from a **user activation**. `progress` ticks from `0` to `1`.
- **`ready`** — the instance is live; action methods can be called freely.
- **`error`** — `availability()` or `create()` rejected. Call `prepare()` to retry.

## Usage

Action methods are gated by the lifecycle — they throw `UnsupportedError`, `UnavailableError`, `NoUserActivationError`, or `NotReadyError` when the state forbids them. **A call rejected by the gate never mutates the hook's `status` or `error`.** (A call made from `idle` that triggers a download is not gate-rejected — it drives `status` through `downloading` to `ready` or `error` like `prepare()`.)

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
        //    the download here if status was "idle"; otherwise it runs at once.
        const out = await translator.translate("…some text…");
        console.log(out);
      }}
    >
      {translator.status === "downloading"
        ? `Downloading (${translator.progress * 100}%)`
        : "Translate"}
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
  // unsupported / unavailable / no-activation — render a fallback.
}
```

Each `create*` mirrors the hook lifecycle exactly — same three typed errors (`UnsupportedError`, `UnavailableError`, `NoUserActivationError`), same progress wiring. Unlike the hooks, **other browser rejections surface unchanged** — most commonly `AbortError` when `signal` fires, or `NetworkError` on a failed download. The `instanceof BuiltInAIError` check above is what separates the typed lifecycle errors from those pass-throughs.

The returned instance is `AsyncDisposable` — prefer `await using` so it's released on scope exit. `.destroy()` is also exposed for callers that need to release earlier.

Each creator accepts the same options as its hook, plus an optional `signal` that cancels both the download (if any) and the underlying `create()` call.

Because a creator requires a user activation when a download is needed, prefer calling it from an event handler — or pre-warm the model via the matching hook elsewhere in the tree before the call site is reached.

## Download progress

- **Per-instance** — read `progress` and `status` from the hook return (or the creator's lifecycle, which writes to the same place).
- **Cross-instance** — `useGlobalDownloadProgress(namespace?)` reports the highest in-flight progress across every instance, regardless of which component (or imperative caller) initiated the download. Pass a namespace (`"Translator"`, `"Rewriter"`, `"Proofreader"`, `"Summarizer"`, `"Writer"`, `"LanguageDetector"`) to scope to one API, or call with no argument to aggregate across all Built-in AI downloads.

```tsx
function GlobalDownloadBar() {
  const progress = useGlobalDownloadProgress();
  if (progress === null) return null;
  return <ProgressBar value={progress} />;
}
```

## Option changes

| Behavior          | Detail                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Equality          | Shallow per-key, `Object.is`                                                                            |
| Stable references | Memoize array-valued options (e.g. `expectedInputLanguages`) to avoid spurious re-creation              |
| On change         | Destroys the current instance, aborts in-flight work with `AbortError`, and re-enters the state machine |

## Errors

Lifecycle gating throws `BuiltInAIError` subclasses. Action methods (`translate`, `rewrite`, …) pass the browser API's own rejections through unchanged — most commonly an `AbortError` `DOMException` when a `signal` fires. When the lifecycle wraps a browser rejection into `"error"` state, the original error is preserved as `error.cause`.

| Error                   | What to do                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `UnsupportedError`      | The namespace is missing. Feature-detect with `isSupported()` and render a fallback.                                          |
| `UnavailableError`      | The device can't run the model. Render a fallback; don't retry.                                                               |
| `NoUserActivationError` | A download was needed without a user gesture. Trigger `prepare()` (or the first action) from a click/keypress handler.        |
| `NotReadyError`         | A prior `create()` failed. Call `prepare()` from a user activation to retry; inspect `error.cause` for the underlying reason. |

## Cancellation

A per-call `signal` cancels the _caller's_ wait and the underlying action call, but does not tear down the shared model instance. If the hook is mid-download, aborting one call rejects that call with `AbortError` while the download keeps running for any other caller (and for the next call from the same component). **The download is only cancelled when the component unmounts or its options change.**

## Security

No network calls — everything runs against the browser's on-device model. Releases are published to npm with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements) so the bytes you install can be traced back to a specific GitHub Actions run.

Found a security issue? Open a private advisory at [github.com/shayc/react-built-in-ai/security/advisories/new](https://github.com/shayc/react-built-in-ai/security/advisories/new).

## Versioning

Semver; see [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup (Node 22+, Vitest browser mode, the changeset workflow).

## License

[MIT](LICENSE) © Shay Cojocaru
