# `@shayc/react-built-in-ai`

[![npm version](https://img.shields.io/npm/v/@shayc/react-built-in-ai.svg)](https://www.npmjs.com/package/@shayc/react-built-in-ai)
[![CI](https://github.com/shayc/react-built-in-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/shayc/react-built-in-ai/actions/workflows/ci.yml)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@shayc/react-built-in-ai)](https://bundlephobia.com/package/@shayc/react-built-in-ai)

React hooks for the browser's [built-in AI](https://developer.chrome.com/docs/ai/built-in) APIs: translate, summarize, write, rewrite, proofread, detect languages, and prompt with browser-managed, on-device models. No API key, server, or per-token cost.

- A React hook and imperative creator for each of the seven APIs
- One lifecycle for availability, gesture-gated downloads, progress, and cleanup
- Streaming where the browser API supports it
- TypeScript-first, tree-shakeable ESM with no runtime dependencies (~9 kB gzipped)

## Install

```bash
npm install @shayc/react-built-in-ai
```

React 18 or 19 is required. The APIs only run in a browser; the hooks render safely during SSR, but components using them must be client components (`"use client"` in React Server Component setups).

## API availability

Built-in AI availability changes independently of this package. The current Chrome surface is:

| Browser API                                                                  | React hook            | Imperative creator       | Chrome availability              |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------ | -------------------------------- |
| [Translator](https://developer.chrome.com/docs/ai/translator-api)            | `useTranslator`       | `createTranslator`       | Stable, desktop, 138+            |
| [Language Detector](https://developer.chrome.com/docs/ai/language-detection) | `useLanguageDetector` | `createLanguageDetector` | Stable, desktop, 138+            |
| [Summarizer](https://developer.chrome.com/docs/ai/summarizer-api)            | `useSummarizer`       | `createSummarizer`       | Stable, desktop, 138+            |
| [Prompt](https://developer.chrome.com/docs/ai/prompt-api)                    | `useLanguageModel`    | `createLanguageModel`    | Stable 148+; extensions from 138 |
| [Writer](https://developer.chrome.com/docs/ai/writer-api)                    | `useWriter`           | `createWriter`           | Developer trial                  |
| [Rewriter](https://developer.chrome.com/docs/ai/rewriter-api)                | `useRewriter`         | `createRewriter`         | Developer trial                  |
| [Proofreader](https://developer.chrome.com/docs/ai/proofreader-api)          | `useProofreader`      | `createProofreader`      | Developer trial                  |

See Chrome's [live API status](https://developer.chrome.com/docs/ai/built-in-apis) before shipping. Microsoft Edge implements compatible globals, but versions and release channels vary by API; see its [writing](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/writing-assistance-apis), [translation](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api), and [Prompt](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) documentation.

Every integration should handle `unsupported` and `unavailable`. Hardware, storage, policy, and model availability can make an exposed API unavailable on a particular device.

## Quick start

```tsx
import { useState } from "react";
import { useTranslator } from "@shayc/react-built-in-ai";

export function Translate() {
  const translator = useTranslator({
    sourceLanguage: "en",
    targetLanguage: "es",
  });
  const [output, setOutput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (translator.status === "checking") {
    return <p>Checking availability…</p>;
  }
  if (translator.status === "unsupported") {
    return <p>Not supported here.</p>;
  }
  if (translator.status === "unavailable") {
    return <p>Not available on this device.</p>;
  }

  if (translator.status === "error") {
    return (
      <>
        <button
          onClick={() => {
            setActionError(null);
            void translator.prepare().catch((error: unknown) => {
              setActionError(
                error instanceof Error ? error.message : "Retry failed",
              );
            });
          }}
        >
          Retry
        </button>
        <p role="alert">
          {actionError ?? translator.error?.message ?? "Initialization failed"}
        </p>
      </>
    );
  }

  const downloading = translator.status === "downloading";

  return (
    <>
      <button
        disabled={downloading}
        onClick={async () => {
          setActionError(null);
          try {
            setOutput(await translator.translate("Hello, world."));
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            setActionError(
              error instanceof Error ? error.message : "Translation failed",
            );
          }
        }}
      >
        {downloading
          ? translator.progress === null
            ? "Downloading…"
            : `Downloading (${Math.round(translator.progress * 100)}%)`
          : translator.status === "downloadable"
            ? "Download and translate"
            : "Translate"}
      </button>
      {output && <p>{output}</p>}
      {actionError && <p role="alert">{actionError}</p>}
    </>
  );
}
```

If the model is not cached, the first click authorizes its download and waits for the translation. Later calls run against the browser-managed model directly.

## Hook lifecycle

Every hook exposes `status`, `progress`, `error`, and `prepare()`:

| Status         | Recommended UI                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| `checking`     | Show a short loading state while the hook probes or creates a cached model.    |
| `downloadable` | Enable a button that calls `prepare()` or the task method from a user gesture. |
| `downloading`  | Disable duplicate actions and show `progress` when it is available.            |
| `ready`        | Enable normal task actions.                                                    |
| `unsupported`  | Render a browser/API fallback.                                                 |
| `unavailable`  | Render a device fallback; retrying will not help.                              |
| `error`        | Show `error` and call `prepare()` from a retry button.                         |

`progress` is `null` until the browser reports a fraction, then a number from `0` to `1`. It returns to `null` outside `downloading`. The browser requires a transient user activation to start a model download, so call `prepare()` or the first task action directly from a click or keypress—not from an effect, timer, page load, or after an `await`.

Task hooks with structurally equal options share an underlying instance, so inline option objects and arrays do not need memoization. `useLanguageModel` is the exception: each mount owns a private conversation. See the [advanced lifecycle guide](https://github.com/shayc/react-built-in-ai/blob/main/docs/lifecycle.md) for download revalidation, progress aggregation, sharing, option changes, and retries.

### Capability utilities

Inside React, prefer the hook's `status`; it is SSR-safe and includes device availability. `isSupported(name)` is useful outside React or when choosing between separate components. Do not use it during SSR to select different server and client markup—the built-in globals do not exist on the server.

`checkAvailability(name, options?)` performs a one-shot browser readiness probe without mounting a hook or creating an instance. Translator options are required because availability depends on the language pair. It throws `UnsupportedError` when the matching global is absent.

## Hook surface

| Hook                  | Task methods                                         | Result and notes                                         |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `useTranslator`       | `translate`, `translateStream`, `measureInput`       | `string`; requires source and target languages           |
| `useLanguageDetector` | `detect`, `measureInput`                             | Ranked `LanguageDetectionResult[]`; no streaming         |
| `useSummarizer`       | `summarize`, `summarizeStream`, `measureInput`       | `string`                                                 |
| `useWriter`           | `write`, `writeStream`, `measureInput`               | `string`                                                 |
| `useRewriter`         | `rewrite`, `rewriteStream`, `measureInput`           | `string`                                                 |
| `useProofreader`      | `proofread`                                          | `ProofreadResult`; no streaming or input measurement     |
| `useLanguageModel`    | `prompt`, `promptStream`, `append`, `measureContext` | Stateful session; also exposes `reset` and context state |

The five measured task hooks expose `inputQuota`, which is `0` until the model is ready. Every task method accepts the browser API's per-call options, including an optional `signal` for cancellation.

### Streaming

Streaming methods return `AsyncIterable<string>` chunks:

```tsx
setOutput("");
for await (const chunk of translator.translateStream(input, { signal })) {
  setOutput((previous) => previous + chunk);
}
```

Breaking or throwing out of the loop cancels the underlying stream.

## Imperative creators

Use a creator when options are decided mid-flow or a hook cannot represent the workflow:

```ts
import { createTranslator } from "@shayc/react-built-in-ai";

async function translate(
  input: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  await using translator = await createTranslator({
    sourceLanguage,
    targetLanguage,
  });
  return translator.translate(input);
}
```

- Creators accept the hook options plus `signal`, and return the raw browser instance as `AsyncDisposable`. On older toolchains, call `.destroy()` in `finally`.
- They use the same availability, activation, download, and cancellation rules as hooks, but expose no reactive `status`, `error`, retry method, or per-call progress.
- They reject with `UnsupportedError`, `UnavailableError`, or `MissingUserActivationError`; other browser rejections such as `AbortError` and `NetworkError` pass through unchanged.
- Call a creator from a user gesture when it may need to start a download. Joining a download already in flight does not require another gesture.

## Global download progress

`useGlobalDownloadProgress(namespaces?)` reports the least-complete download started by any hook or creator. Pass a namespace, an array, or nothing to observe all Built-in AI downloads. An in-flight download with no browser progress event yet contributes `0`; when every matching download finishes, the value returns to `null` rather than remaining at `1`.

## Prompt sessions

`useLanguageModel` wraps the stateful Prompt API and differs from the task hooks in three ways:

- Each mount owns a private session; equal options never share conversation state.
- Options are captured at mount. Use `reset(nextOptions)` or a `key` remount to change them.
- The raw session is hidden. Use `createLanguageModel()` when you need `clone()` or direct lifecycle control.

The hook also exposes `contextUsage`, `contextWindow`, and `overflowCount`. Prompt and append calls update usage; `reset()` discards the conversation and provisions a fresh session. When `overflowCount` increases, applications that must preserve older context can summarize their own transcript and call `reset({ ...options, initialPrompts })`. `reset(nextOptions)` replaces the full options object, so include every option the new session needs.

## Errors and cancellation

Lifecycle gates use `BuiltInAIError` subclasses:

| Error                        | Meaning and response                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `UnsupportedError`           | The namespace is absent. Render a browser/API fallback.                                         |
| `UnavailableError`           | The device cannot run the model. Render a fallback rather than retrying.                        |
| `MissingUserActivationError` | A download must start from a user gesture. Move `prepare()` or the task call into that handler. |
| `NotReadyError`              | A prior probe or `create()` failed. Inspect `.cause` and call `prepare()` to retry.             |

Browser action errors pass through unchanged. In particular, cancellation rejects with a `DOMException` named `AbortError`; treat it as cancellation rather than a lifecycle failure. A per-call signal cancels that caller's wait and action, not a shared model download. The last unmount or option change tears down an unreferenced task instance and aborts its work.

## Security

The library makes no network requests and sends task inputs nowhere. The browser manages model downloads, caching, updates, and eviction; inference runs on-device. Releases are published to npm with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements).

Report vulnerabilities through a [private GitHub security advisory](https://github.com/shayc/react-built-in-ai/security/advisories/new).

[Changelog](https://github.com/shayc/react-built-in-ai/blob/main/CHANGELOG.md) · [Contributing](https://github.com/shayc/react-built-in-ai/blob/main/CONTRIBUTING.md) · [MIT License](https://github.com/shayc/react-built-in-ai/blob/main/LICENSE) © Shay Cojocaru
