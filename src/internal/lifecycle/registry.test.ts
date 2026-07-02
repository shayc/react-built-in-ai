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
});
