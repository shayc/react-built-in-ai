import { useState } from "react";
import { useLifecycle } from "../internal/lifecycle/use-lifecycle";
import type { BaseHookReturn } from "../types";

/**
 * Options for {@link useLanguageDetector}. Mirrors `LanguageDetector.create()`
 * minus the hook-managed `signal` and `monitor`. Compared by value, so inline
 * literals are safe without memoization.
 *
 * @see https://developer.chrome.com/docs/ai/language-detection
 */
export type LanguageDetectorOptions = Omit<
  LanguageDetectorCreateOptions,
  "signal" | "monitor"
>;

/** Per-call options for {@link useLanguageDetector} action methods. */
export type DetectCallOptions = LanguageDetectorDetectOptions;

/**
 * Return value of {@link useLanguageDetector}. Extends {@link BaseHookReturn}
 * with the LanguageDetector action methods.
 *
 * Unlike the writing hooks, `detect` resolves with an array of candidate
 * languages (each with a confidence score) rather than a string, and the
 * underlying API offers no streaming variant.
 */
export interface LanguageDetectorHookReturn extends BaseHookReturn {
  /**
   * Detects the language(s) of `input`, resolving with the browser's ranked
   * `LanguageDetectionResult` candidates. Streaming is not supported by the
   * underlying API.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  detect: (
    input: string,
    options?: DetectCallOptions,
  ) => Promise<LanguageDetectionResult[]>;
  /**
   * Estimated usage of `input` against
   * {@link LanguageDetectorHookReturn.inputQuota}.
   *
   * @throws See {@link BaseHookReturn.prepare}.
   */
  measureInput: (input: string, options?: DetectCallOptions) => Promise<number>;
  /** Maximum input the current instance accepts. `0` until `status` is `"ready"`. */
  inputQuota: number;
}

/**
 * React hook around the browser's [Language Detector API](https://developer.chrome.com/docs/ai/language-detection).
 * See {@link BaseHookReturn} for lifecycle and gating rules, and the README
 * quick start for a complete status-to-UI example.
 */
export function useLanguageDetector(
  options?: LanguageDetectorOptions,
): LanguageDetectorHookReturn {
  const { status, progress, error, prepare, inputQuota, acquire } =
    useLifecycle<LanguageDetectorOptions, LanguageDetector>(
      "LanguageDetector",
      options,
      (instance) => instance.inputQuota,
    );

  const [actions] = useState(() => ({
    async detect(
      input: string,
      opts?: DetectCallOptions,
    ): Promise<LanguageDetectionResult[]> {
      const { instance, signal } = await acquire(opts?.signal);
      return instance.detect(input, { ...opts, signal });
    },
    async measureInput(input: string, opts?: DetectCallOptions) {
      const { instance, signal } = await acquire(opts?.signal);
      return instance.measureInputUsage(input, { ...opts, signal });
    },
  }));

  return { status, progress, error, prepare, inputQuota, ...actions };
}
