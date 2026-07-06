import { describe, expect, test, vi } from "vitest";
import { checkAvailability } from "./check-availability";
import { UnsupportedError } from "./errors";
import type { BuiltInAIName } from "./is-supported";

// Shape shared by every non-Translator `*CreateCoreOptions` interface, so it
// stays assignable regardless of which real API `NAMESPACE` stands in for.
interface TestOptions {
  outputLanguage?: string;
}

const NAMESPACE = "__CheckAvailabilityTestAI" as Exclude<
  BuiltInAIName,
  "Translator"
>;

describe("checkAvailability", () => {
  test("throws UnsupportedError when the global namespace is absent", async () => {
    vi.stubGlobal(NAMESPACE, undefined);

    await expect(checkAvailability(NAMESPACE)).rejects.toBeInstanceOf(
      UnsupportedError,
    );
  });

  test.each([
    "available",
    "downloadable",
    "downloading",
    "unavailable",
  ] as const)("passes an '%s' result through unchanged", async (status) => {
    const create = vi.fn();
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve(status)),
      create,
    });

    await expect(checkAvailability(NAMESPACE)).resolves.toBe(status);
    expect(create).not.toHaveBeenCalled();
  });

  test("forwards options to the namespace's availability()", async () => {
    const availability = vi.fn(() => Promise.resolve("available" as const));
    vi.stubGlobal(NAMESPACE, { availability, create: vi.fn() });

    const options: TestOptions = { outputLanguage: "en" };
    await checkAvailability(NAMESPACE, options);

    expect(availability).toHaveBeenCalledWith(options);
  });

  test("does not require a user activation", async () => {
    Object.defineProperty(navigator, "userActivation", {
      value: { isActive: false },
      configurable: true,
    });

    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable" as const)),
      create: vi.fn(),
    });

    await expect(checkAvailability(NAMESPACE)).resolves.toBe("downloadable");

    delete (navigator as unknown as { userActivation?: unknown })
      .userActivation;
  });

  test("passes an availability() rejection through unchanged", async () => {
    const original = new Error("availability boom");
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.reject(original)),
      create: vi.fn(),
    });

    await expect(checkAvailability(NAMESPACE)).rejects.toBe(original);
  });

  test("types the options argument per-name (compile-time)", () => {
    // These arrows are never executed; tsc type-checks the calls statically.

    // Translator's options are required — no create() has an unconditional
    // "does this exist" answer, but Translator's availability() genuinely
    // needs a language pair to give one.
    // @ts-expect-error - Translator requires options
    void (() => checkAvailability("Translator"));

    // @ts-expect-error - Writer options aren't assignable to Translator's
    void (() => checkAvailability("Translator", { tone: "more-formal" }));

    // create()-only members (e.g. sharedContext) aren't consumed by
    // availability(), so they're rejected here even though create() accepts
    // them.
    // @ts-expect-error - sharedContext is a create()-only option
    void (() => checkAvailability("Writer", { sharedContext: "context" }));

    void (() =>
      checkAvailability("Translator", {
        sourceLanguage: "en",
        targetLanguage: "es",
      }));
    void (() => checkAvailability("Summarizer"));
    void (() => checkAvailability("Summarizer", { type: "tldr" }));

    // An unnarrowed BuiltInAIName no longer type-checks option-free, since
    // that name could be "Translator" — the caller must narrow first.
    // @ts-expect-error - name isn't narrowed away from "Translator"
    void ((name: BuiltInAIName) => checkAvailability(name));
  });
});
