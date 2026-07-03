import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MissingUserActivationError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import { provisionInstance, provisionStandalone } from "./provision";
import { snapshotDownloadProgress } from "./registry";
import type { AINamespace } from "./types";

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

describe("provisionInstance", () => {
  test("throws MissingUserActivationError when a download is needed without a gesture", async () => {
    setUserActivation(false);
    const create = vi.fn();
    const namespace: AINamespace<TestOptions, TestInstance> = {
      availability: vi.fn(),
      create,
    };

    await expect(
      provisionInstance({
        namespace,
        options: { mode: "a" },
        availability: "downloadable",
      }),
    ).rejects.toBeInstanceOf(MissingUserActivationError);
    expect(create).not.toHaveBeenCalled();
  });

  test("does not require activation when availability is 'available'", async () => {
    setUserActivation(false);
    const instance: TestInstance = { destroy: vi.fn(), marker: "live" };
    const namespace: AINamespace<TestOptions, TestInstance> = {
      availability: vi.fn(),
      create: vi.fn(() => Promise.resolve(instance)),
    };

    const created = await provisionInstance({
      namespace,
      options: { mode: "a" },
      availability: "available",
    });

    expect(created.marker).toBe("live");
  });

  test("wires the download monitor when a download is required", async () => {
    setUserActivation(true);
    const onProgress = vi.fn();
    const create = vi.fn((opts?: { monitor?: (m: CreateMonitor) => void }) => {
      const monitor = new EventTarget() as CreateMonitor;
      opts?.monitor?.(monitor);
      monitor.dispatchEvent(
        Object.assign(new Event("downloadprogress"), { loaded: 0.5 }),
      );
      return Promise.resolve({ destroy: vi.fn() });
    });
    const namespace: AINamespace<TestOptions, TestInstance> = {
      availability: vi.fn(),
      create,
    };

    await provisionInstance({
      namespace,
      options: { mode: "a" },
      availability: "downloadable",
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  test("does not wire a monitor on the available fast path", async () => {
    let capturedMonitor: CreateMonitorCallback | undefined;
    const namespace: AINamespace<TestOptions, TestInstance> = {
      availability: vi.fn(),
      create: vi.fn((opts?: { monitor?: CreateMonitorCallback }) => {
        capturedMonitor = opts?.monitor;
        return Promise.resolve({ destroy: vi.fn() });
      }),
    };

    await provisionInstance({
      namespace,
      options: { mode: "a" },
      availability: "available",
    });

    expect(capturedMonitor).toBeUndefined();
  });

  test("forwards the signal to create()", async () => {
    const create = vi.fn(() => Promise.resolve({ destroy: vi.fn() }));
    const namespace: AINamespace<TestOptions, TestInstance> = {
      availability: vi.fn(),
      create,
    };
    const controller = new AbortController();

    await provisionInstance({
      namespace,
      options: { mode: "a" },
      availability: "available",
      signal: controller.signal,
    });

    const [createArg] = create.mock.calls[0] as unknown as [
      { signal?: AbortSignal },
    ];
    expect(createArg.signal).toBe(controller.signal);
  });

  test("returned instance is AsyncDisposable and disposal destroys it", async () => {
    const destroy = vi.fn();
    const instance: TestInstance = { destroy, marker: "disposable" };
    const namespace: AINamespace<TestOptions, TestInstance> = {
      availability: vi.fn(),
      create: vi.fn(() => Promise.resolve(instance)),
    };

    {
      await using created = await provisionInstance({
        namespace,
        options: { mode: "a" },
        availability: "available",
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
    const namespace: AINamespace<TestOptions, typeof instance> = {
      availability: vi.fn(),
      create: vi.fn(() => Promise.resolve(instance)),
    };

    const created = await provisionInstance({
      namespace,
      options: { mode: "a" },
      availability: "available",
    });
    expect(created[Symbol.asyncDispose]).toBe(nativeDispose);
  });
});

describe("provisionStandalone", () => {
  test("throws UnsupportedError when the namespace global is absent", async () => {
    vi.stubGlobal(NAMESPACE, undefined);
    await expect(
      provisionStandalone<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  test("throws UnavailableError when availability is 'unavailable'", async () => {
    const create = vi.fn();
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("unavailable")),
      create,
    });

    await expect(
      provisionStandalone<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
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
      provisionStandalone<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    ).rejects.toBeInstanceOf(MissingUserActivationError);
    expect(create).not.toHaveBeenCalled();
  });

  test("creates an instance when available without requiring activation", async () => {
    const instance: TestInstance = { destroy: vi.fn(), marker: "live" };
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve(instance)),
    });

    const created = await provisionStandalone<TestOptions, TestInstance>(
      NAMESPACE,
      { mode: "a" },
    );

    expect(created.marker).toBe("live");
  });

  test("does not pass signal into availability()", async () => {
    const availability = vi.fn(() => Promise.resolve("available" as const));
    vi.stubGlobal(NAMESPACE, {
      availability,
      create: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    });

    const controller = new AbortController();
    await provisionStandalone<TestOptions, TestInstance>(
      NAMESPACE,
      { mode: "a" },
      controller.signal,
    );

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
      provisionStandalone<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    ).rejects.toBe(original);
    expect(create).not.toHaveBeenCalled();
  });

  test("registers external download progress at 0 and clears it after create resolves", async () => {
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

    const pending = provisionStandalone<TestOptions, TestInstance>(NAMESPACE, {
      mode: "a",
    });

    await vi.waitFor(() =>
      expect(snapshotDownloadProgress([NAMESPACE])).toBe(0),
    );

    resolveCreate({ destroy: vi.fn() });
    await pending;

    expect(snapshotDownloadProgress([NAMESPACE])).toBeNull();
  });

  test("does not affect download progress reported for other namespaces", async () => {
    const OTHER_NAMESPACE = "__OtherTestAI" as BuiltInAIName;
    setUserActivation(true);
    let resolveOther!: (value: TestInstance) => void;
    vi.stubGlobal(OTHER_NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create: vi.fn(
        () =>
          new Promise<TestInstance>((resolve) => {
            resolveOther = resolve;
          }),
      ),
    });
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    });

    const otherPending = provisionStandalone<TestOptions, TestInstance>(
      OTHER_NAMESPACE,
      { mode: "a" },
    );
    await vi.waitFor(() =>
      expect(snapshotDownloadProgress([OTHER_NAMESPACE])).toBe(0),
    );

    await provisionStandalone<TestOptions, TestInstance>(NAMESPACE, {
      mode: "a",
    });
    expect(snapshotDownloadProgress([NAMESPACE])).toBeNull();
    expect(snapshotDownloadProgress([OTHER_NAMESPACE])).toBe(0);

    resolveOther({ destroy: vi.fn() });
    await otherPending;
  });
});
