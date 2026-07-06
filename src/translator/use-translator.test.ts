import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { buildAIFake } from "../internal/testing/ai-namespace-fake";
import { buildTranslatorInstance } from "../internal/testing/instance-fakes";
import { createTranslator } from "./create-translator";
import { useTranslator } from "./use-translator";

describe("useTranslator", () => {
  test("exposes the instance's inputQuota once ready", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildTranslatorInstance });
    vi.stubGlobal("Translator", Fake);

    const { result } = await renderHook(() =>
      useTranslator({ sourceLanguage: "en", targetLanguage: "fr" }),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(1024);
  });

  test("translate() forwards input and resolves with the instance's result", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildTranslatorInstance });
    vi.stubGlobal("Translator", Fake);

    const { result } = await renderHook(() =>
      useTranslator({ sourceLanguage: "en", targetLanguage: "fr" }),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(result.current.translate("hi")).resolves.toBe("T:hi");
  });

  test("translateStream() yields the instance's chunks", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildTranslatorInstance });
    vi.stubGlobal("Translator", Fake);

    const { result } = await renderHook(() =>
      useTranslator({ sourceLanguage: "en", targetLanguage: "fr" }),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const chunks: string[] = [];
    for await (const chunk of result.current.translateStream("anything")) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["T:", "hello"]);
  });

  test("measureInput() forwards input to the instance", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildTranslatorInstance });
    vi.stubGlobal("Translator", Fake);

    const { result } = await renderHook(() =>
      useTranslator({ sourceLanguage: "en", targetLanguage: "fr" }),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(result.current.measureInput("hi")).resolves.toBe(7);
  });

  test("requires a TranslatorOptions argument (compile-time)", () => {
    // These arrows are never executed; tsc type-checks the calls statically,
    // verifying the options argument is required (both missing and undefined are rejected).
    // @ts-expect-error - options argument is required
    void (() => useTranslator());
    // @ts-expect-error - options argument is not optional
    void (() => useTranslator(undefined));
  });
});

describe("createTranslator", () => {
  test("resolves an AsyncDisposable instance delegating to the namespace", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildTranslatorInstance,
    });
    vi.stubGlobal("Translator", Fake);

    const translator = await createTranslator({
      sourceLanguage: "en",
      targetLanguage: "fr",
    });

    expect(translator).toBe(instances[0]);
    expect(
      (translator as unknown as Record<symbol, unknown>)[Symbol.asyncDispose],
    ).toBeTypeOf("function");
    await expect(translator.translate("hi")).resolves.toBe("T:hi");
  });
});
