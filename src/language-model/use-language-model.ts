import { useRef, useState } from "react";
import { useOwnedLifecycle } from "../internal/lifecycle/use-owned-lifecycle";
import { streamChunks } from "../internal/stream";
import type { BaseHookReturn } from "../types";

/**
 * Options for {@link useLanguageModel}. Mirrors `LanguageModel.create()` minus
 * the hook-managed `signal` and `monitor`, and minus the raw sampling params
 * (`topK` / `temperature`) — those are origin-trial / extension-gated and
 * mid-redesign on the web surface, so passing them here would be a
 * silently-ignored DX trap. The spec's proposed replacement, `samplingMode`,
 * stays in the type (IDL ignores it until it ships) but is not yet a working
 * knob in stable Chrome.
 *
 * Unlike the task-API hooks, these options are **captured once at mount** and
 * never re-read — a stateful conversation must not be silently discarded
 * because a parent re-rendered with a fresh literal. Change them explicitly
 * via {@link LanguageModelHookReturn.reset} or a `key=` remount. Inline option
 * literals are therefore safe here precisely because they're ignored after the
 * first render.
 *
 * @see https://developer.chrome.com/docs/ai/prompt-api
 */
export type LanguageModelOptions = Omit<
  LanguageModelCreateOptions,
  "signal" | "monitor" | "topK" | "temperature"
>;

/** Per-call options for {@link useLanguageModel}'s `prompt`-family methods. */
export type PromptCallOptions = LanguageModelPromptOptions;

/**
 * Return value of {@link useLanguageModel}. Extends {@link BaseHookReturn} with
 * the Prompt API session methods and live context-window state.
 */
export interface LanguageModelHookReturn extends BaseHookReturn {
  /**
   * Sends `input` to the session and resolves with the full response. Mutates
   * the conversation history.
   *
   * @throws See {@link BaseHookReturn.prepare}. Prompt-time browser rejections
   * pass through unwrapped — e.g. `QuotaExceededError` (whose `contextWindow`
   * property is the tokens *available* at call time), `NotSupportedError`,
   * `SyntaxError` (unsatisfiable `responseConstraint`), or `AbortError`.
   */
  prompt(
    input: LanguageModelPrompt,
    options?: PromptCallOptions,
  ): Promise<string>;
  /**
   * Streams the response as it is produced. Concatenating all chunks yields the
   * same result as {@link prompt}, and the turn is committed to history the
   * same way.
   *
   * @throws See {@link prompt}.
   */
  promptStream(
    input: LanguageModelPrompt,
    options?: PromptCallOptions,
  ): AsyncIterable<string>;
  /**
   * Appends `input` to the session history without prompting for a response —
   * useful for pre-loading context ahead of a later {@link prompt}.
   *
   * @throws See {@link prompt}.
   */
  append(
    input: LanguageModelPrompt,
    options?: LanguageModelAppendOptions,
  ): Promise<void>;
  /**
   * Estimates how many tokens `input` would add to {@link contextUsage} without
   * sending it.
   *
   * @throws See {@link prompt}.
   */
  measureContext(
    input: LanguageModelPrompt,
    options?: PromptCallOptions,
  ): Promise<number>;
  /** Current usage of the session's context window. `0` until ready. */
  contextUsage: number;
  /** Context-window size of the current session. `0` until ready. */
  contextWindow: number;
  /**
   * Number of `contextoverflow` events this session has fired (the browser
   * auto-evicting old turns to make room). Resets to `0` on {@link reset}.
   * `useEffect` on it to drive the session-compacting pattern: summarize the
   * transcript, then `reset(compactedInitialPrompts)`.
   */
  overflowCount: number;
  /**
   * Discards the current conversation and provisions a fresh session — with the
   * same options, or with `nextOptions` (a full replacement, not a merge).
   * Aborts any in-flight call with `AbortError`, destroys the old session, and
   * zeroes {@link contextUsage} / {@link overflowCount}. Passing compacted
   * `initialPrompts` here is the documented session-compacting / -restore path.
   */
  reset(nextOptions?: LanguageModelOptions): void;
  /**
   * Pre-warms the session — probes availability and runs `create()` (prefilling
   * `initialPrompts` and populating {@link contextWindow}). From `downloadable`,
   * call it from a user-activation handler to authorize the model download;
   * from `error`, it re-probes and doubles as the retry path.
   *
   * Unlike the task-API hooks, this session is owned by this mount alone — it's
   * never shared with an equal-options sibling — so a retry here is visible
   * only to this component. It can still reject with `AbortError` if
   * {@link reset} or unmount tears the session down mid-flight.
   *
   * @throws A {@link BuiltInAIError} subclass — `UnsupportedError`,
   * `UnavailableError`, `MissingUserActivationError`, or `NotReadyError` — or a
   * `DOMException` named `AbortError`.
   */
  prepare: () => Promise<void>;
}

/**
 * React hook around the browser's [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
 * (`LanguageModel`). See {@link BaseHookReturn} for the lifecycle and gating
 * rules.
 *
 * Unlike the six task-API hooks, each mount owns a private session: equal
 * options never share one instance (conversations must stay isolated), and
 * options are captured at mount rather than structurally re-keyed. The model
 * download is still deduplicated by the browser across every `create()`, so
 * concurrent mounts join the same in-flight download gesture-free. See the
 * README for lifecycle UI and session-compaction guidance.
 */
export function useLanguageModel(
  options?: LanguageModelOptions,
): LanguageModelHookReturn {
  const { status, progress, error, prepare, inputQuota, acquire, replace } =
    useOwnedLifecycle<LanguageModelOptions, LanguageModel>(
      "LanguageModel",
      options,
      (instance) => instance.contextWindow,
    );

  const [contextUsage, setContextUsage] = useState(0);
  const [overflowCount, setOverflowCount] = useState(0);
  // The session is hidden, so consumers can't attach the contextoverflow
  // listener themselves — the hook does, exactly once per instance (an owned
  // session is never prompted by anyone else, so no event can be missed). The
  // ref tracks the last instance a listener was wired to, and doubles as the
  // currency guard for both writers below: reset() nulls it before zeroing
  // the counters, so nothing the discarded session does afterwards — a
  // finally from an aborted in-flight call, an already-queued overflow
  // event — can write over the fresh session's zeros.
  const listenedInstance = useRef<LanguageModel | null>(null);

  const [actions] = useState(() => {
    function ensureOverflowListener(instance: LanguageModel): void {
      if (listenedInstance.current === instance) {
        return;
      }
      listenedInstance.current = instance;
      instance.addEventListener("contextoverflow", () => {
        // Currency guard: an event from a session reset() has discarded must
        // not bump the new session's zeroed counter.
        if (listenedInstance.current === instance) {
          setOverflowCount((count) => count + 1);
        }
      });
    }
    // Read live usage after every turn. Abort-safe: eviction isn't undone by
    // aborting, and aborted turns are removed from history, so the post-call
    // read is accurate either way. Gated on the instance still being current:
    // reset() zeroes the counters synchronously, but a discarded session's
    // in-flight action still runs its finally after the store swap aborts
    // it — unguarded, that would resurrect the dead session's usage over the
    // fresh zero.
    function syncUsage(instance: LanguageModel): void {
      if (listenedInstance.current === instance) {
        setContextUsage(instance.contextUsage);
      }
    }
    return {
      async prompt(input: LanguageModelPrompt, opts?: PromptCallOptions) {
        const { instance, signal } = await acquire(opts?.signal);
        ensureOverflowListener(instance);
        try {
          return await instance.prompt(input, { ...opts, signal });
        } finally {
          syncUsage(instance);
        }
      },
      async *promptStream(
        input: LanguageModelPrompt,
        opts?: PromptCallOptions,
      ): AsyncIterable<string> {
        const { instance, signal } = await acquire(opts?.signal);
        ensureOverflowListener(instance);
        try {
          const stream = instance.promptStreaming(input, { ...opts, signal });
          yield* streamChunks(stream, signal);
        } finally {
          syncUsage(instance);
        }
      },
      async append(
        input: LanguageModelPrompt,
        opts?: LanguageModelAppendOptions,
      ) {
        const { instance, signal } = await acquire(opts?.signal);
        ensureOverflowListener(instance);
        try {
          await instance.append(input, { ...opts, signal });
        } finally {
          syncUsage(instance);
        }
      },
      async measureContext(
        input: LanguageModelPrompt,
        opts?: PromptCallOptions,
      ) {
        const { instance, signal } = await acquire(opts?.signal);
        return instance.measureContextUsage(input, { ...opts, signal });
      },
      reset(nextOptions?: LanguageModelOptions) {
        // Nulling the ref both forgets the old instance (the next action
        // re-attaches the overflow listener to the fresh session) and arms
        // the currency guards above against the old session's late writes.
        listenedInstance.current = null;
        setContextUsage(0);
        setOverflowCount(0);
        replace(nextOptions);
      },
    };
  });

  return {
    status,
    progress,
    error,
    prepare,
    contextUsage,
    contextWindow: inputQuota,
    overflowCount,
    ...actions,
  };
}
