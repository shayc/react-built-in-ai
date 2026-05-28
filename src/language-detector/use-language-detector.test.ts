import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { makeAIFake } from "../internal/testing/ai-namespace-fake";
import { buildLanguageDetectorInstance } from "../internal/testing/instance-fakes";
import { useLanguageDetector } from "./use-language-detector";

describe("useLanguageDetector", () => {
  test("exposes the instance's inputQuota once ready", async () => {
    const { Fake } = makeAIFake({
      buildInstance: buildLanguageDetectorInstance,
    });
    vi.stubGlobal("LanguageDetector", Fake);

    const { result } = await renderHook(() => useLanguageDetector());

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(512);
  });

  test("detect() forwards input and resolves with the instance's ranked candidates", async () => {
    const { Fake, instances } = makeAIFake({
      buildInstance: buildLanguageDetectorInstance,
    });
    vi.stubGlobal("LanguageDetector", Fake);

    const { result } = await renderHook(() => useLanguageDetector());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const out = await result.current.detect("hello world");
    expect(instances[0].detect).toHaveBeenCalledWith(
      "hello world",
      expect.anything(),
    );
    expect(out).toEqual([
      { detectedLanguage: "en", confidence: 0.99 },
      { detectedLanguage: "fr", confidence: 0.01 },
    ]);
  });

  test("exposes no streaming variant (compile-time)", () => {
    // Arrow is never invoked — runtime skipped; tsc still type-checks the access.
    void (() => {
      const ret = useLanguageDetector();
      // @ts-expect-error - detectStream is not part of LanguageDetectorHookReturn
      void ret.detectStream;
    });
  });
});
