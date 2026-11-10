import { describe, expect, test, vi } from "vitest";
import {
  buildKey,
  externalDownload,
  snapshotDownloadProgress,
  subscribeDownloads,
} from "./registry";

describe("buildKey", () => {
  test("returns the bare name when options are empty or undefined", () => {
    expect(buildKey("Summarizer", undefined)).toBe("Summarizer");
    expect(buildKey("Summarizer", {})).toBe("Summarizer");
  });

  test("appends a JSON-stringified options suffix when present", () => {
    expect(
      buildKey("Translator", {
        sourceLanguage: "en",
        targetLanguage: "fr",
      }),
    ).toBe('Translator:{"sourceLanguage":"en","targetLanguage":"fr"}');
  });

  test("is order-independent across differently-ordered option objects", () => {
    const a = buildKey("Translator", {
      sourceLanguage: "en",
      targetLanguage: "fr",
    });
    const b = buildKey("Translator", {
      targetLanguage: "fr",
      sourceLanguage: "en",
    });
    expect(a).toBe(b);
  });

  test("an options object made entirely of undefined-valued props equals the bare name", () => {
    // JSON.stringify drops undefined-valued props, so { foo: undefined }
    // serializes the same as {} — both must collapse to the bare name.
    expect(buildKey("Summarizer", { foo: undefined })).toBe("Summarizer");
  });
});

describe("externalDownload", () => {
  const KEY = "__ExternalDownloadTest";

  /** Subscribes for the test's duration, recording the aggregate per notification. */
  function recordAggregate(): { seen: (number | null)[]; stop: () => void } {
    const seen: (number | null)[] = [];
    const stop = subscribeDownloads(() => {
      seen.push(snapshotDownloadProgress([KEY]));
    });
    return { seen, stop };
  }

  test("reports 0 on start, then each distinct fraction, to the aggregate and onProgress alike", () => {
    const { seen, stop } = recordAggregate();
    // The aggregate as onProgress sees it: already updated on every call.
    const atCallback: (number | null)[] = [];
    const onProgress = vi.fn(() => {
      atCallback.push(snapshotDownloadProgress([KEY]));
    });
    const download = externalDownload(KEY, onProgress);

    download.start();
    download.report(0);
    download.report(0.5);
    download.report(0.5);
    download.report(1);
    download.end();
    stop();

    expect(onProgress.mock.calls).toEqual([[0], [0.5], [1]]);
    expect(atCallback).toEqual([0, 0.5, 1]);
    expect(seen).toEqual([0, 0.5, 1, null]);
  });

  test("is inert outside the start()..end() window", () => {
    const { seen, stop } = recordAggregate();
    const onProgress = vi.fn();
    const download = externalDownload(KEY, onProgress);

    download.report(0.3);
    expect(snapshotDownloadProgress([KEY])).toBeNull();

    download.start();
    download.end();
    download.report(0.7);
    download.end();
    stop();

    expect(onProgress.mock.calls).toEqual([[0]]);
    expect(seen).toEqual([0, null]);
  });

  test("ending a download that never started notifies nobody", () => {
    const { seen, stop } = recordAggregate();
    const onProgress = vi.fn();

    externalDownload(KEY, onProgress).end();
    stop();

    expect(onProgress).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
