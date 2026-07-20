import { useState } from "react";
import { useLifecycle } from "../internal/lifecycle/use-lifecycle";
import { streamChunks } from "../internal/stream";
import type { BaseHookReturn } from "../types";

/**
 * Options for {@link useWriter}. Mirrors `Writer.create()` minus the
 * hook-managed `signal` and `monitor`. Compared by value, so inline literals
 * are safe without memoization.
 *
 * @see https://developer.chrome.com/docs/ai/writer-api
 */
export type WriterOptions = Omit<WriterCreateOptions, "signal" | "monitor">;

/** Per-call options for {@link useWriter} action methods. */
export type WriteCallOptions = WriterWriteOptions;

export interface WriterHookReturn extends BaseHookReturn {
  /**
   * Writes from `input` and resolves with the full result.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  write: (input: string, options?: WriteCallOptions) => Promise<string>;
  /**
   * Streams the output as it is produced. Concatenating all chunks yields the
   * same result as {@link write}.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  writeStream: (
    input: string,
    options?: WriteCallOptions,
  ) => AsyncIterable<string>;
  /**
   * Estimated usage of `input` against {@link WriterHookReturn.inputQuota}.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  measureInput: (input: string, options?: WriteCallOptions) => Promise<number>;
  /** Maximum input the current instance accepts. `0` until `status` is `"ready"`. */
  inputQuota: number;
}

/**
 * React hook around the browser's [Writer API](https://developer.chrome.com/docs/ai/writer-api).
 * See {@link BaseHookReturn} for lifecycle and gating rules, and the README
 * quick start for a complete status-to-UI example.
 */
export function useWriter(options?: WriterOptions): WriterHookReturn {
  const { status, progress, error, prepare, inputQuota, acquire } =
    useLifecycle<WriterOptions, Writer>(
      "Writer",
      options,
      (instance) => instance.inputQuota,
    );

  const [actions] = useState(() => ({
    async write(input: string, opts?: WriteCallOptions) {
      const { instance, signal } = await acquire(opts?.signal);
      return instance.write(input, { ...opts, signal });
    },
    async *writeStream(
      input: string,
      opts?: WriteCallOptions,
    ): AsyncIterable<string> {
      const { instance, signal } = await acquire(opts?.signal);
      const stream = instance.writeStreaming(input, { ...opts, signal });
      yield* streamChunks(stream, signal);
    },
    async measureInput(input: string, opts?: WriteCallOptions) {
      const { instance, signal } = await acquire(opts?.signal);
      return instance.measureInputUsage(input, { ...opts, signal });
    },
  }));

  return { status, progress, error, prepare, inputQuota, ...actions };
}
