import { describe, expect, test, vi } from "vitest";
import {
  invalidateAvailability,
  subscribeAvailability,
} from "./availability-store";

describe("availability-store", () => {
  test("invalidateAvailability notifies a subscriber with the key", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAvailability((key) => seen.push(key));

    invalidateAvailability('Translator:{"sourceLanguage":"en"}');

    expect(seen).toEqual(['Translator:{"sourceLanguage":"en"}']);
    unsubscribe();
  });

  test("notifies every active subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeAvailability(a);
    const unsubB = subscribeAvailability(b);

    invalidateAvailability("Summarizer");

    expect(a).toHaveBeenCalledWith("Summarizer");
    expect(b).toHaveBeenCalledWith("Summarizer");
    unsubA();
    unsubB();
  });

  test("an unsubscribed listener stops receiving events", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAvailability(listener);

    unsubscribe();
    invalidateAvailability("Writer");

    expect(listener).not.toHaveBeenCalled();
  });

  test("is a no-op when there are no subscribers", () => {
    expect(() => invalidateAvailability("Rewriter")).not.toThrow();
  });
});
