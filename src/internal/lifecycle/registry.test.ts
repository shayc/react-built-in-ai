import { describe, expect, test } from "vitest";
import { buildKey } from "./registry";

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
