import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import {
  clearDownloadProgress,
  setDownloadProgress,
} from "./internal/progress-store";
import { useGlobalDownloadProgress } from "./use-global-download-progress";

function cleanup(...keys: string[]): void {
  for (const k of keys) {
    clearDownloadProgress(k);
  }
}

afterEach(() => {
  cleanup(
    "Translator",
    "Translator:en:fr",
    "Translator:en:de",
    'Translator:{"sourceLanguage":"en","targetLanguage":"fr"}',
    "Rewriter",
    "Proofreader",
    "Summarizer",
  );
});

describe("useGlobalDownloadProgress", () => {
  test("reports the least-complete in-flight progress matching the namespace", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );
    expect(result.current).toBeNull();

    setDownloadProgress("Translator:en:fr", 0.25);
    await vi.waitFor(() => expect(result.current).toBe(0.25));

    setDownloadProgress("Translator:en:de", 0.7);
    await vi.waitFor(() => expect(result.current).toBe(0.25));

    setDownloadProgress("Translator:en:fr", 0.8);
    await vi.waitFor(() => expect(result.current).toBe(0.7));
  });

  test("never moves backwards when the further-along download completes", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );

    setDownloadProgress("Translator:en:fr", 0.2);
    setDownloadProgress("Translator:en:de", 0.9);
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    clearDownloadProgress("Translator:en:de");
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    setDownloadProgress("Translator:en:fr", 0.5);
    await vi.waitFor(() => expect(result.current).toBe(0.5));
  });

  test("matches an exact namespace key as well as `namespace:…` keys", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );

    setDownloadProgress("Translator", 0.5);
    await vi.waitFor(() => expect(result.current).toBe(0.5));
  });

  test("ignores keys outside the requested namespace", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );

    // A lower-value write in a different namespace must not leak in: a
    // larger-value write in our namespace should still be the reported value.
    // If filtering were broken, the hook would report 0.1 (the least complete).
    setDownloadProgress("Rewriter", 0.1);
    setDownloadProgress("Translator", 0.3);
    await vi.waitFor(() => expect(result.current).toBe(0.3));
  });

  test("aggregates across the requested namespaces only", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress(["Proofreader", "Rewriter"]),
    );
    expect(result.current).toBeNull();

    setDownloadProgress("Translator:en:fr", 0.1);
    await vi.waitFor(() => expect(result.current).toBeNull());

    setDownloadProgress("Proofreader", 0.5);
    await vi.waitFor(() => expect(result.current).toBe(0.5));

    setDownloadProgress("Rewriter", 0.3);
    await vi.waitFor(() => expect(result.current).toBe(0.3));

    clearDownloadProgress("Rewriter");
    await vi.waitFor(() => expect(result.current).toBe(0.5));
  });

  test("with no argument, aggregates across every namespace", async () => {
    const { result } = await renderHook(() => useGlobalDownloadProgress());
    expect(result.current).toBeNull();

    setDownloadProgress("Rewriter", 0.6);
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    setDownloadProgress("Translator:en:fr", 0.2);
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    clearDownloadProgress("Translator:en:fr");
    await vi.waitFor(() => expect(result.current).toBe(0.6));
  });

  test("treats an explicit undefined argument like the no-argument call", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress(undefined),
    );
    expect(result.current).toBeNull();

    setDownloadProgress("Rewriter", 0.6);
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    setDownloadProgress("Translator:en:fr", 0.2);
    await vi.waitFor(() => expect(result.current).toBe(0.2));
  });
});
