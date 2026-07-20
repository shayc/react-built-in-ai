# Advanced lifecycle behavior

The [README](https://github.com/shayc/react-built-in-ai#hook-lifecycle) defines the status-to-UI contract. This guide covers the less visible behavior behind it.

## Download revalidation

If a hook parked at `downloadable` is called without activation, it rechecks availability once. This handles a model that another component or tab downloaded in the meantime:

- `available`: create the cached model and continue.
- `downloading`: join the existing download without another gesture.
- `downloadable`: remain parked and reject the caller with `MissingUserActivationError`.

The last case does not set `status: "error"` or populate `error`; the lifecycle itself did not fail. The temporary recheck may pass through `checking` before returning to `downloadable`.

## Progress

A task hook reports `status: "downloading"` as soon as it starts or joins a download. Its `progress` remains `null` until the browser reports a fraction, avoiding a fabricated `0` for a joined download that may already be partway complete.

`useGlobalDownloadProgress()` includes hook- and creator-driven downloads. It treats an in-flight download with no progress event as `0`, then returns the minimum progress among matching downloads. Completed downloads leave the aggregate, so `null` means that no matching download is in flight; do not wait for a persistent `1`.

## Sharing and option changes

The six task hooks share a module-level lifecycle store when both of these match:

- Built-in AI namespace
- Options by value

Option object keys are sorted before JSON encoding, and properties whose value is `undefined` are ignored. Fresh inline objects and arrays with the same content therefore select the same store; no `useMemo` is required.

Matching mounts observe the same `status`, `progress`, `error`, and browser instance. When task-hook options change:

- Work for the old options continues while another component retains that store.
- Otherwise, the old instance is destroyed and its in-flight work rejects with `AbortError`.
- The component creates or joins the store for the new options.

`useLanguageModel` captures options at mount instead. Change its options with `reset(nextOptions)` or a keyed remount so a parent render cannot silently discard a conversation.

## Shared retries and teardown

From `error`, `prepare()` tears down the failed generation and starts the same options again. A retry from one component is therefore visible to every component using equal options, and it aborts sibling action calls and pending lifecycle waits with `AbortError`.

A per-call signal cancels only that caller's wait and action; it does not tear down a shared instance or download. The instance is destroyed when its final holder unmounts or changes options.
