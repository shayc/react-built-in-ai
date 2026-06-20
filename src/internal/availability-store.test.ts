import { describe, expect, test, vi } from "vitest";
import {
  invalidateAvailability,
  subscribeAvailability,
} from "./availability-store";

describe("availability-store", () => {
  test("notifies every active subscriber once with the key", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeAvailability(a);
    const unsubB = subscribeAvailability(b);

    invalidateAvailability("Summarizer");

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith("Summarizer");
    expect(b).toHaveBeenCalledTimes(1);
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
});
