import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MissingUserActivationError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import { subscribeAvailability } from "../availability-store";
import {
  clearDownloadProgress,
  setDownloadProgress,
  snapshotProgressFor,
} from "../progress-store";
import { createInstance } from "./create-instance";

interface TestOptions {
  mode?: string;
}

interface TestInstance {
  destroy: () => void;
  marker?: string;
}

const NAMESPACE = "__TestAI" as BuiltInAIName;

function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive },
    configurable: true,
  });
}

afterEach(() => {
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
});

describe("createInstance", () => {
  test("throws UnsupportedError when the namespace global is absent", async () => {
    vi.stubGlobal(NAMESPACE, undefined);
    await expect(
      createInstance<TestOptions, TestInstance>({
        name: NAMESPACE,
        options: { mode: "a" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  test("throws UnavailableError when availability is 'unavailable'", async () => {
    const create = vi.fn();
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("unavailable")),
      create,
    });

    await expect(
      createInstance<TestOptions, TestInstance>({
        name: NAMESPACE,
        options: { mode: "a" },
      }),
    ).rejects.toBeInstanceOf(UnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  test("throws MissingUserActivationError when downloadable without a user gesture", async () => {
    setUserActivation(false);
    const create = vi.fn();
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    await expect(
      createInstance<TestOptions, TestInstance>({
        name: NAMESPACE,
        options: { mode: "a" },
      }),
    ).rejects.toBeInstanceOf(MissingUserActivationError);
    expect(create).not.toHaveBeenCalled();
  });

  test("creates an instance when available without requiring activation", async () => {
    const instance: TestInstance = { destroy: vi.fn(), marker: "live" };
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve(instance)),
    });

    const created = await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
    });

    expect(created.marker).toBe("live");
  });

  test("forwards the caller's AbortSignal to create()", async () => {
    const create = vi.fn(() => Promise.resolve({ destroy: vi.fn() }));
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create,
    });

    const controller = new AbortController();
    await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
      signal: controller.signal,
    });

    const [createArg] = create.mock.calls[0] as unknown as [
      { signal?: AbortSignal },
    ];
    expect(createArg.signal).toBe(controller.signal);
  });

  test("does not pass signal into availability()", async () => {
    const availability = vi.fn(() => Promise.resolve("available" as const));
    vi.stubGlobal(NAMESPACE, {
      availability,
      create: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    });

    const controller = new AbortController();
    await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
      signal: controller.signal,
    });

    const [arg] = availability.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(arg).not.toHaveProperty("signal");
    expect(arg).toEqual({ mode: "a" });
  });

  test("passes an availability() rejection through unchanged (not wrapped)", async () => {
    const original = new Error("availability boom");
    const create = vi.fn();
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.reject(original)),
      create,
    });

    await expect(
      createInstance<TestOptions, TestInstance>({
        name: NAMESPACE,
        options: { mode: "a" },
      }),
    ).rejects.toBe(original);
    expect(create).not.toHaveBeenCalled();
  });

  test("returned instance is AsyncDisposable and disposal destroys it", async () => {
    const destroy = vi.fn();
    const instance: TestInstance = { destroy, marker: "disposable" };
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve(instance)),
    });

    {
      await using created = await createInstance<TestOptions, TestInstance>({
        name: NAMESPACE,
        options: { mode: "a" },
      });
      expect(typeof created[Symbol.asyncDispose]).toBe("function");
      expect(destroy).not.toHaveBeenCalled();
    }

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("does not redefine [Symbol.asyncDispose] when the instance already implements it", async () => {
    const nativeDispose = vi.fn(() => Promise.resolve());
    const instance = {
      destroy: vi.fn(),
      [Symbol.asyncDispose]: nativeDispose,
    };
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve(instance)),
    });

    const created = await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
    });
    expect(created[Symbol.asyncDispose]).toBe(nativeDispose);
  });

  test("writes 0 to the progress store at download start and clears it after create resolves", async () => {
    setUserActivation(true);
    let resolveCreate!: (value: TestInstance) => void;
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create: vi.fn(
        () =>
          new Promise<TestInstance>((resolve) => {
            resolveCreate = resolve;
          }),
      ),
    });

    const pending = createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
    });

    await vi.waitFor(() => expect(snapshotProgressFor([NAMESPACE])).toBe(0));

    resolveCreate({ destroy: vi.fn() });
    await pending;

    expect(snapshotProgressFor([NAMESPACE])).toBeNull();
    clearDownloadProgress(`${NAMESPACE}:{"mode":"a"}`);
  });

  test("does not touch the progress store on the available fast path", async () => {
    const OTHER_NAMESPACE = "__OtherTestAI";
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    });

    setDownloadProgress(OTHER_NAMESPACE, 0.42);
    await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
    });
    expect(snapshotProgressFor([NAMESPACE])).toBeNull();
    expect(snapshotProgressFor([OTHER_NAMESPACE])).toBe(0.42);
    clearDownloadProgress(OTHER_NAMESPACE);
  });

  test("announces availability invalidation for the key after a download completes", async () => {
    setUserActivation(true);
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    });

    const invalidated: string[] = [];
    const unsubscribe = subscribeAvailability((key) => invalidated.push(key));

    await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
    });

    expect(invalidated).toEqual([`${NAMESPACE}:{"mode":"a"}`]);
    unsubscribe();
  });

  test("does not announce availability invalidation on the available fast path", async () => {
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    });

    const invalidated: string[] = [];
    const unsubscribe = subscribeAvailability((key) => invalidated.push(key));

    await createInstance<TestOptions, TestInstance>({
      name: NAMESPACE,
      options: { mode: "a" },
    });

    expect(invalidated).toEqual([]);
    unsubscribe();
  });

  test("does not announce availability invalidation when the download's create() fails", async () => {
    setUserActivation(true);
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create: vi.fn(() => Promise.reject(new Error("create boom"))),
    });

    const invalidated: string[] = [];
    const unsubscribe = subscribeAvailability((key) => invalidated.push(key));

    await expect(
      createInstance<TestOptions, TestInstance>({
        name: NAMESPACE,
        options: { mode: "a" },
      }),
    ).rejects.toThrow("create boom");

    expect(invalidated).toEqual([]);
    unsubscribe();
  });
});
