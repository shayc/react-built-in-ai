import { useState } from "react";
import { useLifecycle } from "../internal/lifecycle/use-lifecycle";
import { streamChunks } from "../internal/stream";
import type { BaseHookReturn } from "../types";

/**
 * Options for {@link useSummarizer}. Mirrors `Summarizer.create()` minus the
 * hook-managed `signal` and `monitor`. Compared structurally (sorted-key
 * identity, not reference) — inline option literals, including array-valued
 * options, are safe without memoization.
 *
 * @see https://developer.chrome.com/docs/ai/summarizer-api
 */
export type SummarizerOptions = Omit<
  SummarizerCreateOptions,
  "signal" | "monitor"
>;

/** Per-call options for {@link useSummarizer} action methods. */
export type SummarizeCallOptions = SummarizerSummarizeOptions;

/**
 * Return value of {@link useSummarizer}. Extends {@link BaseHookReturn} with the
 * Summarizer action methods.
 */
export interface SummarizerHookReturn extends BaseHookReturn {
  /**
   * Summarizes `input` and resolves with the full result.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  summarize: (input: string, options?: SummarizeCallOptions) => Promise<string>;
  /**
   * Streams the summary as it is produced. Concatenating all chunks yields the
   * same result as {@link summarize}.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  summarizeStream: (
    input: string,
    options?: SummarizeCallOptions,
  ) => AsyncIterable<string>;
  /**
   * Estimated usage of `input` against {@link SummarizerHookReturn.inputQuota}.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  measureInput: (
    input: string,
    options?: SummarizeCallOptions,
  ) => Promise<number>;
  /** Maximum input the current instance accepts. `0` until `status` is `"ready"`. */
  inputQuota: number;
}

/**
 * React hook around the browser's [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api).
 * See {@link BaseHookReturn} for the lifecycle and gating rules.
 *
 * @example
 * ```tsx
 * function Summary({ article }: { article: string }) {
 *   const summarizer = useSummarizer({ type: "key-points", length: "short" });
 *   return (
 *     <button
 *       disabled={summarizer.status === "downloading"}
 *       onClick={async () => setOutput(await summarizer.summarize(article))}
 *     >
 *       Summarize
 *     </button>
 *   );
 * }
 * ```
 */
export function useSummarizer(
  options?: SummarizerOptions,
): SummarizerHookReturn {
  const { status, progress, error, prepare, inputQuota, acquire } =
    useLifecycle<SummarizerOptions, Summarizer>(
      "Summarizer",
      options,
      (instance) => instance.inputQuota,
    );

  const [actions] = useState(() => ({
    async summarize(input: string, opts?: SummarizeCallOptions) {
      const { instance, signal } = await acquire(opts?.signal);
      return instance.summarize(input, { ...opts, signal });
    },
    async *summarizeStream(
      input: string,
      opts?: SummarizeCallOptions,
    ): AsyncIterable<string> {
      const { instance, signal } = await acquire(opts?.signal);
      const stream = instance.summarizeStreaming(input, { ...opts, signal });
      yield* streamChunks(stream, signal);
    },
    async measureInput(input: string, opts?: SummarizeCallOptions) {
      const { instance, signal } = await acquire(opts?.signal);
      return instance.measureInputUsage(input, { ...opts, signal });
    },
  }));

  return { status, progress, error, prepare, inputQuota, ...actions };
}
