import { describe, expect, test, vi } from "vitest";
import { abortError, mergeSignals, raceAbort } from "./signal";

describe("abortError", () => {
  test("returns a DOMException with name 'AbortError' for a string reason", () => {
    const error = abortError("nope");
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("nope");
  });

  test("passes through an existing AbortError unchanged", () => {
    const original = new DOMException("first", "AbortError");
    expect(abortError(original)).toBe(original);
  });

  test("wraps a non-AbortError DOMException", () => {
    const other = new DOMException("oops", "NotAllowedError");
    const wrapped = abortError(other);
    expect(wrapped).not.toBe(other);
    expect(wrapped.name).toBe("AbortError");
  });

  test("coerces unknown reasons to the literal 'Aborted'", () => {
    expect(abortError({ weird: true }).message).toBe("Aborted");
    expect(abortError(undefined).message).toBe("Aborted");
  });
});

describe("mergeSignals", () => {
  test("returns the primary signal as-is when there is no secondary signal", () => {
    const a = new AbortController().signal;
    expect(mergeSignals(a, undefined)).toBe(a);
  });

  test("aborts when any of the input signals aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const merged = mergeSignals(a.signal, b.signal);

    expect(merged.aborted).toBe(false);
    const reason = new DOMException("b fired", "AbortError");
    b.abort(reason);
    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe(reason);
  });
});

describe("raceAbort", () => {
  test("resolves with the promise value when the signal stays clear", async () => {
    const { signal } = new AbortController();
    await expect(raceAbort(Promise.resolve(42), signal)).resolves.toBe(42);
  });

  test("rejects with the signal reason when the signal aborts before the promise settles", async () => {
    const controller = new AbortController();
    const reason = new DOMException("stop", "AbortError");
    const pending = raceAbort(new Promise(() => undefined), controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  test("rejects immediately when called with an already-aborted signal", async () => {
    const controller = new AbortController();
    const reason = new DOMException("pre-aborted", "AbortError");
    controller.abort(reason);
    await expect(
      raceAbort(new Promise(() => undefined), controller.signal),
    ).rejects.toBe(reason);
  });

  test("rejects with the promise's own error when the signal stays clear", async () => {
    const { signal } = new AbortController();
    const original = new Error("inner");
    await expect(raceAbort(Promise.reject(original), signal)).rejects.toBe(
      original,
    );
  });

  test("passes a non-Error rejection through unchanged rather than masking it as AbortError", async () => {
    const { signal } = new AbortController();
    // A thrown string is a genuine failure, not a cancellation: it must reach
    // the caller verbatim, not be rewrapped as an AbortError DOMException.
    const rejected = Promise.reject("boom");
    await expect(raceAbort(rejected, signal)).rejects.toBe("boom");
  });

  test.each([
    ["resolves", () => Promise.resolve("ok")],
    ["rejects", () => Promise.reject(new Error("inner"))],
  ])(
    "aborts its cleanup signal once the promise %s",
    async (_outcome, build) => {
      const { signal } = new AbortController();
      const addSpy = vi.spyOn(signal, "addEventListener");

      await raceAbort(build(), signal).catch(() => undefined);

      const options = addSpy.mock.calls[0]?.[2] as
        | AddEventListenerOptions
        | undefined;
      expect(options?.signal?.aborted).toBe(true);
    },
  );

  test("aborts its cleanup signal when cancellation wins the race", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const pending = raceAbort(new Promise(() => undefined), controller.signal);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const options = addSpy.mock.calls[0]?.[2] as
      | AddEventListenerOptions
      | undefined;
    expect(options?.signal?.aborted).toBe(true);
  });
});
