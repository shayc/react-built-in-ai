---
"@shayc/react-built-in-ai": minor
---

Add Prompt API (`LanguageModel`) support: the `useLanguageModel` hook and `createLanguageModel` creator, with `LanguageModelOptions`, `PromptCallOptions`, `LanguageModelHookReturn`, and `CreateLanguageModelOptions` types exported. `"LanguageModel"` is now a `BuiltInAIName`, so `isSupported`, `checkAvailability`, and `useGlobalDownloadProgress` cover it too.

Unlike the six stateless task hooks, `useLanguageModel` owns a private session per mount (conversations stay isolated; equal options never share an instance), captures its options at mount rather than re-keying on every render, and exposes session state: `prompt` / `promptStream` / `append` / `measureContext`, live `contextUsage` and `contextWindow`, an `overflowCount` counter for the session-compacting pattern, and `reset(nextOptions?)` to discard the conversation and provision a fresh session. The model download is still deduplicated by the browser across sessions. The raw `topK` / `temperature` sampling params are omitted from the option type (origin-trial / extension-gated and mid-redesign on the web surface).

The Prompt API ships on Chrome 148+ (web) — a later floor than the other six APIs' 138+ — or via the official `prompt-api-polyfill`.
