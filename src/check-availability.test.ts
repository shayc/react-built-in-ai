import { describe, expect, test, vi } from "vitest";
import { checkAvailability } from "./check-availability";
import { UnsupportedError } from "./errors";
import type { BuiltInAIName } from "./is-supported";

interface TestOptions {
  mode?: string;
}

const NAMESPACE = "__CheckAvailabilityTestAI" as BuiltInAIName;

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

    const options: TestOptions = { mode: "a" };
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
});
