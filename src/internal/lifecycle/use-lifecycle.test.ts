import { createElement, StrictMode } from "react";
import { renderToString } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from "vitest";
import { render, renderHook } from "vitest-browser-react";
import {
  BuiltInAIError,
  MissingUserActivationError,
  NotReadyError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import { buildAIFake } from "../testing/ai-namespace-fake";
import {
  __resetForTests,
  __sizeForTests,
  snapshotDownloadProgress,
  subscribeDownloads,
} from "./registry";
import { createStore } from "./store";
import { useLifecycle } from "./use-lifecycle";

interface TestOptions {
  mode?: string;
}

interface TestInstance {
  destroy: Mock<() => void>;
  inputQuota?: number;
  marker?: string;
}

const NAMESPACE = "__TestAI" as BuiltInAIName;

function buildInstance(overrides: Partial<TestInstance> = {}): TestInstance {
  return { destroy: vi.fn<() => void>(), inputQuota: 1024, ...overrides };
}

function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive },
    configurable: true,
  });
}

beforeEach(() => {
  setUserActivation(false);
  // The registry is module-level state that outlives any single test. The
  // browser test runner unmounts rendered hooks between tests (releasing
  // their retains), but this is a deterministic backstop against leaks —
  // e.g. a test that constructs a store directly (bypassing the registry
  // and vitest-browser-react's auto-unmount) and forgets to release it.
  __resetForTests();
});

afterEach(() => {
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
});

describe("useLifecycle", () => {
  test("reports unsupported when the global is undefined", async () => {
    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("unsupported"));
    expect(result.current.error).toBeNull();
    expect(result.current.inputQuota).toBe(0);
  });

  test("transitions checking → ready when availability is 'available'", async () => {
    const { Fake, create } = buildAIFake({
      status: "available",
      buildInstance: () => buildInstance({ marker: "primary" }),
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(
        NAMESPACE,
        { mode: "a" },
        (instance) => instance.inputQuota ?? 0,
      ),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(1024);
    expect(result.current.error).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    const [createArg] = create.mock.calls[0] as [{ monitor?: unknown }];
    expect(createArg.monitor).toBeUndefined();
  });

  test("auto-create on 'available' never passes through 'downloading'", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const inst = buildInstance({ marker: "no-flash" });
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create,
    });

    const observed: string[] = [];
    const { result } = await renderHook(() => {
      const lifecycle = useLifecycle<TestOptions, TestInstance>(
        NAMESPACE,
        undefined,
      );
      observed.push(lifecycle.status);
      return lifecycle;
    });

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe("checking");
    expect(observed).not.toContain("downloading");

    resolveCreate(inst);
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(observed).not.toContain("downloading");
  });

  test("settles at unavailable and never calls create", async () => {
    const { Fake, create } = buildAIFake({
      status: "unavailable",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(create).not.toHaveBeenCalled();
  });

  test("settles in 'downloadable' when a download is required and never auto-creates", async () => {
    const { Fake, create } = buildAIFake({
      status: "downloadable",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));
    expect(result.current.error).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test("joins and reports 'downloading' when the browser is already downloading elsewhere, then settles ready", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn<
      (opts?: { monitor?: unknown }) => Promise<TestInstance>
    >(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    // Joining is gesture-free — no setUserActivation(true) needed.
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));
    expect(result.current.progress).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    const [createArg] = create.mock.calls[0] as [{ monitor?: unknown }];
    expect(createArg.monitor).toBeTypeOf("function");

    resolveCreate(buildInstance());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
  });

  test("a joined download's monitor progress upgrades null to the reported fraction", async () => {
    const monitors: CreateMonitor[] = [];
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn((opts: { monitor?: (m: CreateMonitor) => void }) => {
      const monitor = new EventTarget() as CreateMonitor;
      monitors.push(monitor);
      opts.monitor?.(monitor);
      return new Promise<TestInstance>((resolve) => {
        resolveCreate = resolve;
      });
    });
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));
    expect(result.current.progress).toBeNull();

    monitors[0].dispatchEvent(
      Object.assign(new Event("downloadprogress"), { loaded: 0.6 }),
    );
    await vi.waitFor(() => expect(result.current.progress).toBe(0.6));

    resolveCreate(buildInstance());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
  });

  test("a joined download whose create() resolves hands acquire() that exact instance", async () => {
    const inst = buildInstance({ marker: "joined" });
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create: vi.fn(() => Promise.resolve(inst)),
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const acquired = await result.current.acquire();
    expect(acquired.instance).toBe(inst);
  });

  test("a joined download refused with NotAllowedError re-parks at 'downloadable' instead of erroring", async () => {
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create: vi.fn(() =>
        Promise.reject(new DOMException("needs a gesture", "NotAllowedError")),
      ),
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));
    expect(result.current.error).toBeNull();
  });

  test("a joined download refused with a generic error surfaces as status='error'", async () => {
    const original = new Error("joined create failed");
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create: vi.fn(() => Promise.reject(original)),
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.cause).toBe(original);
  });

  test("prepare() rejects with MissingUserActivationError when downloadable without activation", async () => {
    const { Fake } = buildAIFake({
      status: "downloadable",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    await expect(result.current.prepare()).rejects.toBeInstanceOf(
      MissingUserActivationError,
    );
    expect(result.current.status).toBe("downloadable");
    expect(result.current.error).toBeNull();
  });

  test("prepare() triggers download and reaches ready when userActivation is active", async () => {
    const { Fake, create } = buildAIFake({
      status: "downloadable",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    await result.current.prepare();

    expect(result.current.status).toBe("ready");
    expect(create).toHaveBeenCalledTimes(1);
    const [createArg] = create.mock.calls[0] as [{ monitor?: unknown }];
    expect(createArg.monitor).toBeTypeOf("function");
  });

  test("is visible in the global download-progress aggregate as soon as download starts, and clears on completion", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    // Fire-and-forget to reach "downloading"; teardown aborts it — swallow.
    result.current.prepare().catch(() => undefined);
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    // No downloadprogress event has fired yet, so the raw snapshot is null —
    // the registry derives the aggregate straight from it and coalesces to 0.
    expect(result.current.progress).toBeNull();
    expect(snapshotDownloadProgress([NAMESPACE])).toBe(0);

    resolveCreate(buildInstance());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.progress).toBeNull();
    expect(snapshotDownloadProgress([NAMESPACE])).toBeNull();
  });

  test("unmounting the last holder mid-download notifies global-progress subscribers", async () => {
    // Regression: release() used to unsubscribe the store from the download
    // aggregate *before* the deletion could be announced, so a subscriber
    // (useGlobalDownloadProgress) never learned the entry vanished and would
    // stay frozen at the last-seen progress instead of returning to null.
    const create = vi.fn(() => new Promise<TestInstance>(() => undefined));
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const hook = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() =>
      expect(hook.result.current.status).toBe("downloadable"),
    );

    setUserActivation(true);
    hook.result.current.prepare().catch(() => undefined);
    await vi.waitFor(() =>
      expect(hook.result.current.status).toBe("downloading"),
    );
    expect(snapshotDownloadProgress([NAMESPACE])).toBe(0);

    const listener = vi.fn();
    const unsubscribe = subscribeDownloads(listener);
    await hook.unmount();

    expect(listener).toHaveBeenCalled();
    expect(snapshotDownloadProgress([NAMESPACE])).toBeNull();
    unsubscribe();
  });

  test("emits progress via downloadprogress events while creating", async () => {
    const monitors: CreateMonitor[] = [];
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn((opts: { monitor?: (m: CreateMonitor) => void }) => {
      const monitor = new EventTarget() as CreateMonitor;
      monitors.push(monitor);
      opts.monitor?.(monitor);
      return new Promise<TestInstance>((resolve) => {
        resolveCreate = resolve;
      });
    });
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    void result.current.prepare();

    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));
    expect(result.current.progress).toBeNull();

    monitors[0].dispatchEvent(
      Object.assign(new Event("downloadprogress"), { loaded: 0.4 }),
    );
    await vi.waitFor(() => expect(result.current.progress).toBe(0.4));

    monitors[0].dispatchEvent(
      Object.assign(new Event("downloadprogress"), { loaded: 0.85 }),
    );
    await vi.waitFor(() => expect(result.current.progress).toBe(0.85));

    resolveCreate(buildInstance());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
  });

  test("surfaces a create rejection as status='error' with BuiltInAIError wrapping the cause", async () => {
    const original = new Error("create failed");
    const { Fake } = buildAIFake({
      status: "available",
      buildInstance,
      failCreate: original,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(BuiltInAIError);
    expect(result.current.error?.message).toBe("create failed");
    expect(result.current.error?.cause).toBe(original);
  });

  test("surfaces an availability rejection as status='error'", async () => {
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.reject(new Error("availability boom"))),
      create: vi.fn(),
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(BuiltInAIError);
    expect(result.current.error?.message).toBe("availability boom");
  });

  test("prepare() after error re-runs the chain and reaches ready on retry", async () => {
    let shouldFail = true;
    const create = vi.fn(() =>
      shouldFail
        ? Promise.reject(new Error("create failed"))
        : Promise.resolve(buildInstance({ marker: "retry" })),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("error"));

    shouldFail = false;
    setUserActivation(true);
    await result.current.prepare();

    expect(result.current.status).toBe("ready");
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("prepare() rejects with NotReadyError when the retry also fails", async () => {
    const original = new Error("persistent failure");
    const { Fake, create } = buildAIFake({
      status: "available",
      buildInstance,
      failCreate: original,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("error"));

    await expect(result.current.prepare()).rejects.toMatchObject({
      name: "NotReadyError",
      cause: original,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("acquire() resolves with { instance, signal } once ready", async () => {
    const inst = buildInstance({ marker: "live" });
    const { Fake } = buildAIFake({
      status: "available",
      buildInstance: () => inst,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const acquired = await result.current.acquire();
    expect(acquired.instance).toBe(inst);
    expect(acquired.signal).toBeInstanceOf(AbortSignal);
    expect(acquired.signal.aborted).toBe(false);
  });

  test("acquire() parked during downloading resolves to ready when create completes", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const inst = buildInstance({ marker: "park" });
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    void result.current.prepare();
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    const pending = result.current.acquire();
    resolveCreate(inst);

    const acquired = await pending;
    expect(acquired.instance).toBe(inst);
    expect(result.current.status).toBe("ready");
  });

  test("acquire() parked during a passively-joined download resolves to ready when create completes", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const inst = buildInstance({ marker: "joined-park" });
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    // No setUserActivation(true) — the join itself never required a gesture.
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    const pending = result.current.acquire();
    resolveCreate(inst);

    const acquired = await pending;
    expect(acquired.instance).toBe(inst);
    expect(result.current.status).toBe("ready");
  });

  test("acquire() rejects with the caller's abort reason mid-download", async () => {
    const create = vi.fn(() => new Promise<TestInstance>(() => undefined));
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    // Fire-and-forget to reach "downloading"; teardown aborts it — swallow.
    result.current.prepare().catch(() => undefined);
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    const controller = new AbortController();
    const reason = new DOMException("caller bailed", "AbortError");
    const pending = result.current.acquire(controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  test("acquire() throws UnsupportedError when status='unsupported'", async () => {
    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("unsupported"));

    await expect(result.current.acquire()).rejects.toBeInstanceOf(
      UnsupportedError,
    );
  });

  test("acquire() throws UnavailableError when status='unavailable'", async () => {
    const { Fake } = buildAIFake({
      status: "unavailable",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("unavailable"));

    await expect(result.current.acquire()).rejects.toBeInstanceOf(
      UnavailableError,
    );
  });

  test("acquire() throws NotReadyError carrying the original cause when status='error'", async () => {
    const original = new Error("blew up");
    const { Fake } = buildAIFake({
      status: "available",
      buildInstance,
      failCreate: original,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("error"));

    await expect(result.current.acquire()).rejects.toBeInstanceOf(
      NotReadyError,
    );
    await expect(result.current.acquire()).rejects.toMatchObject({
      name: "NotReadyError",
      cause: original,
    });
  });

  test("destroys the instance on unmount", async () => {
    const inst = buildInstance({ marker: "doomed" });
    const { Fake } = buildAIFake({
      status: "available",
      buildInstance: () => inst,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result, unmount } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await unmount();
    expect(inst.destroy).toHaveBeenCalledTimes(1);
  });

  test("destroys an instance that resolves after unmount", async () => {
    const inst = buildInstance({ marker: "late" });
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create,
    });

    const { unmount } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    await unmount();
    resolveCreate(inst);

    await vi.waitFor(() => expect(inst.destroy).toHaveBeenCalledTimes(1));
  });

  test("unmounting mid-join aborts the epoch; a create resolving after abort is destroyed with no transition", async () => {
    const inst = buildInstance({ marker: "joined-late" });
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloading")),
      create,
    });

    const { result, unmount } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    await unmount();
    resolveCreate(inst);

    await vi.waitFor(() => expect(inst.destroy).toHaveBeenCalledTimes(1));
  });

  test("re-creates and destroys the previous instance when options change", async () => {
    const first = buildInstance({ marker: "one" });
    const second = buildInstance({ marker: "two" });
    const queue: TestInstance[] = [first, second];
    const { Fake, create } = buildAIFake({
      status: "available",
      buildInstance: () => queue.shift()!,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result, rerender } = await renderHook(
      (props: { mode: string } = { mode: "a" }) =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, props),
      { initialProps: { mode: "a" } },
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await rerender({ mode: "b" });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(1));
    expect(second.destroy).not.toHaveBeenCalled();
  });

  test("does NOT re-create when a new options object is shallow-equal to the previous one", async () => {
    const { Fake, create } = buildAIFake({
      status: "available",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result, rerender } = await renderHook(
      (props: { mode: string } = { mode: "a" }) =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, props),
      { initialProps: { mode: "a" } },
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await rerender({ mode: "a" });

    expect(create).toHaveBeenCalledTimes(1);
  });

  test("inline array-valued options do not re-create or loop renders", async () => {
    const { Fake, create } = buildAIFake({
      status: "available",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    // The spread forces a fresh array identity on every render — the shape
    // that crashed with "Too many re-renders" before element-wise comparison.
    const { result, rerender } = await renderHook(
      (props: { languages: string[] } = { languages: ["en"] }) =>
        useLifecycle<{ languages: string[] }, TestInstance>(NAMESPACE, {
          languages: [...props.languages],
        }),
      { initialProps: { languages: ["en"] } },
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await rerender({ languages: ["en"] });

    expect(create).toHaveBeenCalledTimes(1);
  });

  test("re-creates when an array-valued option's contents change", async () => {
    const first = buildInstance({ marker: "one" });
    const second = buildInstance({ marker: "two" });
    const queue: TestInstance[] = [first, second];
    const { Fake, create } = buildAIFake({
      status: "available",
      buildInstance: () => queue.shift()!,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result, rerender } = await renderHook(
      (props: { languages: string[] } = { languages: ["en"] }) =>
        useLifecycle<{ languages: string[] }, TestInstance>(NAMESPACE, props),
      { initialProps: { languages: ["en"] } },
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await rerender({ languages: ["en", "fr"] });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(1));
    expect(second.destroy).not.toHaveBeenCalled();
  });

  test("server-renders the checking snapshot instead of crashing on a missing getServerSnapshot", () => {
    function Probe(): string {
      const lifecycle = useLifecycle<TestOptions, TestInstance>(
        NAMESPACE,
        undefined,
      );
      return lifecycle.status;
    }

    expect(renderToString(createElement(Probe))).toBe("checking");
  });

  test("acquire() rejects with MissingUserActivationError when downloadable without activation", async () => {
    const { Fake } = buildAIFake({
      status: "downloadable",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    await expect(result.current.acquire()).rejects.toBeInstanceOf(
      MissingUserActivationError,
    );
  });

  test("acquire() from downloadable with activation drives the download and resolves", async () => {
    const { Fake, create, instances } = buildAIFake({
      status: "downloadable",
      buildInstance: () => buildInstance({ marker: "gesture" }),
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    const acquired = await result.current.acquire();

    expect(acquired.instance).toBe(instances[0]);
    expect(result.current.status).toBe("ready");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("an options change re-probes out of downloadable", async () => {
    const availability = vi.fn((options?: TestOptions) =>
      Promise.resolve(options?.mode === "b" ? "available" : "downloadable"),
    );
    const create = vi.fn(() => Promise.resolve(buildInstance()));
    vi.stubGlobal(NAMESPACE, { availability, create });

    const { result, rerender } = await renderHook(
      ({ mode }: { mode: string } = { mode: "a" }) =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode }),
      { initialProps: { mode: "a" } },
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));
    expect(create).not.toHaveBeenCalled();

    await rerender({ mode: "b" });

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("acquire() after unmount rejects with AbortError", async () => {
    const { Fake } = buildAIFake({
      status: "available",
      buildInstance: () => buildInstance({ marker: "post-unmount" }),
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result, unmount } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // Capture pre-unmount — `result.current` goes stale; `store.acquire` stays stable.
    const acquire = result.current.acquire;
    await unmount();

    await expect(acquire()).rejects.toMatchObject({ name: "AbortError" });
  });

  test("acquire() retained across an unmount mid-download rejects with AbortError", async () => {
    const create = vi.fn(() => new Promise<TestInstance>(() => undefined));
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result, unmount } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    // Fire-and-forget to reach "downloading"; the unmount below aborts it — swallow.
    result.current.prepare().catch(() => undefined);
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    // Unmounting mid-download must yield a typed AbortError to a retained
    // acquire — never a raw "unexpected lifecycle state" throw.
    const acquire = result.current.acquire;
    await unmount();

    await expect(acquire()).rejects.toMatchObject({ name: "AbortError" });
  });

  test("StrictMode double-mount does not create or leak duplicate instances", async () => {
    const { Fake, create, instances } = buildAIFake({
      status: "available",
      buildInstance: () => buildInstance({ marker: "strict" }),
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(
      () => useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
      { wrapper: StrictMode },
    );

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // StrictMode may launch two creates; the stale one is destroyed. Assert net live === 1.
    const live = instances.filter(
      (inst) => inst.destroy.mock.calls.length === 0,
    );
    expect(live).toHaveLength(1);
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(1);
    // The double mount/unmount/mount refCount churn must settle on exactly
    // one retained registry entry, not an orphan left behind by the stale pass.
    expect(__sizeForTests()).toBe(1);
  });

  test("two concurrent prepare() during downloading share a single create call", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    const p1 = result.current.prepare();
    const p2 = result.current.prepare();
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    resolveCreate(buildInstance({ marker: "shared" }));

    await p1;
    await p2;
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  test("prepare() rejects with AbortError when the hook unmounts mid-download", async () => {
    const create = vi.fn(() => new Promise<TestInstance>(() => undefined));
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    const { result, unmount } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    setUserActivation(true);
    const pending = result.current.prepare();
    await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

    await unmount();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("acquire() during auto-create-on-'available' waits without requiring user activation", async () => {
    let resolveCreate!: (value: TestInstance) => void;
    const inst = buildInstance({ marker: "auto" });
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() => Promise.resolve("available")),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe("checking");

    const pending = result.current.acquire();
    resolveCreate(inst);

    const acquired = await pending;
    expect(acquired.instance).toBe(inst);
    expect(result.current.status).toBe("ready");
  });

  test("two hook instances with different options track lifecycle independently", async () => {
    const { Fake, create, instances } = buildAIFake({
      status: "available",
      buildInstance: () => buildInstance(),
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const hookA = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    );
    const hookB = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "b" }),
    );

    await vi.waitFor(() => expect(hookA.result.current.status).toBe("ready"));
    await vi.waitFor(() => expect(hookB.result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(2);

    await hookA.unmount();
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(instances[1].destroy).not.toHaveBeenCalled();
    expect(hookB.result.current.status).toBe("ready");
  });

  describe("parked 'downloadable' revalidation (P1)", () => {
    test("a gesture-less action succeeds once the model becomes available elsewhere", async () => {
      // Simulates another component (or tab) finishing the download: the
      // first probe parks at "downloadable"; the second (the re-probe) finds
      // it already "available" and provisions quietly, no gesture required.
      let calls = 0;
      const availability = vi.fn(() =>
        Promise.resolve(calls++ === 0 ? "downloadable" : "available"),
      );
      const create = vi.fn<
        (opts?: { monitor?: unknown }) => Promise<TestInstance>
      >(() => Promise.resolve(buildInstance()));
      vi.stubGlobal(NAMESPACE, { availability, create });

      const { result } = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
      );
      await vi.waitFor(() =>
        expect(result.current.status).toBe("downloadable"),
      );

      // No setUserActivation(true) — the default from beforeEach is false.
      const acquired = await result.current.acquire();

      expect(acquired.instance).toBeDefined();
      expect(result.current.status).toBe("ready");
      expect(create).toHaveBeenCalledTimes(1);
      const [createArg] = create.mock.calls[0] as [{ monitor?: unknown }];
      expect(createArg.monitor).toBeUndefined();
    });

    test("stays parked and throws once when the re-probe still reports downloadable", async () => {
      const availability = vi.fn(() =>
        Promise.resolve("downloadable" as const),
      );
      const create = vi.fn();
      vi.stubGlobal(NAMESPACE, { availability, create });

      const { result } = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
      );
      await vi.waitFor(() =>
        expect(result.current.status).toBe("downloadable"),
      );
      const callsAtPark = availability.mock.calls.length;

      await expect(result.current.acquire()).rejects.toBeInstanceOf(
        MissingUserActivationError,
      );

      expect(result.current.status).toBe("downloadable");
      expect(create).not.toHaveBeenCalled();
      // Bounded: exactly one re-probe beyond the initial park, not a spin.
      expect(availability.mock.calls.length).toBe(callsAtPark + 1);
    });

    test("a joined download refused with NotAllowedError twice throws MissingUserActivationError after exactly one re-probe", async () => {
      // Every probe answers "downloading" and every join is refused — the
      // task-await in the "downloading" case re-parks to "downloadable" each
      // time, so this exercises the same reprobed-bound as the plain
      // "downloadable" case above, just entered via a join instead of a
      // direct park.
      const availability = vi.fn(() => Promise.resolve("downloading" as const));
      const create = vi.fn(() =>
        Promise.reject(new DOMException("needs a gesture", "NotAllowedError")),
      );
      vi.stubGlobal(NAMESPACE, { availability, create });

      const { result } = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
      );
      // The initial join is refused too — settles at "downloadable" before
      // acquire() is ever called.
      await vi.waitFor(() =>
        expect(result.current.status).toBe("downloadable"),
      );
      const callsAtPark = availability.mock.calls.length;
      const createCallsAtPark = create.mock.calls.length;

      await expect(result.current.acquire()).rejects.toBeInstanceOf(
        MissingUserActivationError,
      );

      expect(result.current.status).toBe("downloadable");
      // Bounded: exactly one re-probe (and one re-join) beyond the park.
      expect(availability.mock.calls.length).toBe(callsAtPark + 1);
      expect(create.mock.calls.length).toBe(createCallsAtPark + 1);
    });

    test("acquire() rejects with the caller's abort reason when aborted during the gesture-less re-probe", async () => {
      let resolveReprobe!: (value: "downloadable") => void;
      let calls = 0;
      const availability = vi.fn(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve("downloadable" as const);
        }
        return new Promise<"downloadable">((resolve) => {
          resolveReprobe = resolve;
        });
      });
      const create = vi.fn();
      vi.stubGlobal(NAMESPACE, { availability, create });

      const { result } = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
      );
      await vi.waitFor(() =>
        expect(result.current.status).toBe("downloadable"),
      );

      // No setUserActivation(true) — default from beforeEach is false, so
      // acquire() drives the gesture-less re-probe (→ "checking") instead of
      // beginDownload(). Calling acquire() synchronously runs ensureReady() up to
      // its first await, which lands inside that re-probe's
      // availability() call — so by the time acquire() returns, the second
      // call has already happened and can be aborted immediately.
      const controller = new AbortController();
      const reason = new DOMException("caller bailed", "AbortError");
      const pending = result.current.acquire(controller.signal);
      expect(availability).toHaveBeenCalledTimes(2);
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(create).not.toHaveBeenCalled();

      // Let the stalled re-probe settle so it doesn't leak past the test.
      resolveReprobe("downloadable");
    });

    test("two concurrent gesture-less actions on a parked-then-available store share a single create() call", async () => {
      let resolveReprobe!: (value: "available") => void;
      let calls = 0;
      const availability = vi.fn(() => {
        if (calls++ === 0) {
          return Promise.resolve("downloadable" as const);
        }
        // Held open across both concurrent acquire() calls so they race
        // through the state-read-then-transition() window this test is
        // meant to catch — resolving synchronously would let a regression
        // (an await creeping in before the "checking" transition) slip both
        // callers past the single-flight check undetected.
        return new Promise<"available">((resolve) => {
          resolveReprobe = resolve;
        });
      });
      const instance = buildInstance({ marker: "shared" });
      const create = vi.fn(() => Promise.resolve(instance));
      vi.stubGlobal(NAMESPACE, { availability, create });

      const { result } = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
      );
      await vi.waitFor(() =>
        expect(result.current.status).toBe("downloadable"),
      );

      const pending = Promise.all([
        result.current.acquire(),
        result.current.acquire(),
      ]);
      await vi.waitFor(() => expect(availability).toHaveBeenCalledTimes(2));
      resolveReprobe("available");

      const [a, b] = await pending;

      expect(a.instance).toBe(instance);
      expect(b.instance).toBe(instance);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe("lifecycle reset while a request is in flight (P2)", () => {
    test("acquire() rejects with AbortError, not NotReadyError, when the epoch resets after ensureReady() settles", async () => {
      // Constructed against the store directly: the race is a single
      // microtask window between ensureReady() resolving and acquire()'s
      // epoch check, too narrow to force deterministically through React's
      // scheduler.
      const instance = buildInstance();
      vi.stubGlobal(NAMESPACE, {
        availability: vi.fn(() => Promise.resolve("available")),
        create: vi.fn(() => Promise.resolve(instance)),
      });

      const store = createStore<TestOptions, TestInstance>(
        NAMESPACE,
        undefined,
      );
      store.start();
      await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));

      // acquire() synchronously resolves ensureReady() (state is already
      // "ready"), queuing its post-await continuation as a microtask. The
      // very next synchronous statement resets the epoch before that
      // continuation runs.
      const pending = store.acquire();
      store.start();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      store.stop();
    });
  });

  describe("instance sharing (registry)", () => {
    test("two components with equal options share one store: one create() call, both report ready", async () => {
      const { Fake, create, instances } = buildAIFake({
        status: "available",
        buildInstance: () => buildInstance({ marker: "shared" }),
      });
      vi.stubGlobal(NAMESPACE, Fake);

      const hookA = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "shared" }),
      );
      const hookB = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "shared" }),
      );

      await vi.waitFor(() => expect(hookA.result.current.status).toBe("ready"));
      await vi.waitFor(() => expect(hookB.result.current.status).toBe("ready"));

      expect(create).toHaveBeenCalledTimes(1);
      expect(instances).toHaveLength(1);
      expect(__sizeForTests()).toBe(1);
    });

    test("unmounting one of two holders leaves the instance alive; unmounting the last destroys it", async () => {
      const inst = buildInstance({ marker: "refcounted" });
      const { Fake } = buildAIFake({
        status: "available",
        buildInstance: () => inst,
      });
      vi.stubGlobal(NAMESPACE, Fake);

      const hookA = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "shared" }),
      );
      const hookB = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "shared" }),
      );
      await vi.waitFor(() => expect(hookA.result.current.status).toBe("ready"));
      await vi.waitFor(() => expect(hookB.result.current.status).toBe("ready"));

      await hookA.unmount();
      expect(inst.destroy).not.toHaveBeenCalled();
      expect(hookB.result.current.status).toBe("ready");

      await hookB.unmount();
      expect(inst.destroy).toHaveBeenCalledTimes(1);
      expect(__sizeForTests()).toBe(0);
    });

    test("a remount with the same options right after the last unmount reaches ready with a fresh instance", async () => {
      const first = buildInstance({ marker: "one" });
      const second = buildInstance({ marker: "two" });
      const queue: TestInstance[] = [first, second];
      const { Fake, create } = buildAIFake({
        status: "available",
        buildInstance: () => queue.shift()!,
      });
      vi.stubGlobal(NAMESPACE, Fake);

      const hookA = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
          mode: "resurrect",
        }),
      );
      await vi.waitFor(() => expect(hookA.result.current.status).toBe("ready"));
      await hookA.unmount();
      expect(first.destroy).toHaveBeenCalledTimes(1);

      const hookB = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
          mode: "resurrect",
        }),
      );
      await vi.waitFor(() => expect(hookB.result.current.status).toBe("ready"));

      expect(create).toHaveBeenCalledTimes(2);
      expect(__sizeForTests()).toBe(1);
    });

    test("a same-key remount that swaps in during the last holder's unmount commit converges on one entry with a fresh instance", async () => {
      // Genuinely interleaved, not sequential: unlike the test above (which
      // fully awaits the unmount before mounting the replacement), this
      // swaps from a component retaining the key to a *different* component
      // retaining the same key within a single re-render — so the outgoing
      // holder's release() and the incoming holder's retain() run in the
      // same passive-effects flush, the actual shape of D2's "last holder
      // unmounts while a new component is mid-mount" race. (Driving this via
      // two separately-awaited renderHook/unmount calls instead doesn't
      // work: vitest-browser-react's act() explicitly doesn't support
      // overlapping calls, and forcing it corrupts state for later tests.)
      const first = buildInstance({ marker: "one" });
      const second = buildInstance({ marker: "two" });
      const queue: TestInstance[] = [first, second];
      const { Fake, create } = buildAIFake({
        status: "available",
        buildInstance: () => queue.shift()!,
      });
      vi.stubGlobal(NAMESPACE, Fake);

      const captured: {
        a?: ReturnType<typeof useLifecycle<TestOptions, TestInstance>>;
        b?: ReturnType<typeof useLifecycle<TestOptions, TestInstance>>;
      } = {};

      function ChildA(): null {
        captured.a = useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
          mode: "resurrect-same-commit",
        });
        return null;
      }
      function ChildB(): null {
        captured.b = useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
          mode: "resurrect-same-commit",
        });
        return null;
      }
      function Wrapper({ phase }: { phase: "a" | "b" }) {
        return phase === "a" ? createElement(ChildA) : createElement(ChildB);
      }

      const { rerender } = await render(createElement(Wrapper, { phase: "a" }));
      await vi.waitFor(() => expect(captured.a?.status).toBe("ready"));

      await rerender(createElement(Wrapper, { phase: "b" }));
      await vi.waitFor(() => expect(captured.b?.status).toBe("ready"));

      expect(__sizeForTests()).toBe(1);
      expect(create).toHaveBeenCalledTimes(2);
      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(second.destroy).not.toHaveBeenCalled();
    });

    test("two hook calls with the same options in one component converge without a render loop", async () => {
      const { Fake, create, instances } = buildAIFake({
        status: "available",
        buildInstance: () => buildInstance(),
      });
      vi.stubGlobal(NAMESPACE, Fake);

      let renders = 0;
      const { result } = await renderHook(() => {
        renders++;
        const a = useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
          mode: "dual",
        });
        const b = useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
          mode: "dual",
        });
        return { a, b };
      });

      await vi.waitFor(() => expect(result.current.a.status).toBe("ready"));
      await vi.waitFor(() => expect(result.current.b.status).toBe("ready"));

      expect(create).toHaveBeenCalledTimes(1);
      expect(instances).toHaveLength(1);
      expect(renders).toBeLessThan(20);
    });

    test("adopting a sibling's store leaves storeRef pointing at the live store, not a discarded candidate (regression)", async () => {
      // Regression for the storeRef adoption race: when a hook's retain
      // effect discovers a sibling already won the retain for this key, it
      // adopts the sibling's store via setStore(live). A previous bug wrote
      // `storeRef.current = store` in a *separate*, dep-less effect that ran
      // right after — closing over `store` while it was still the
      // pre-adoption candidate (the state update from setStore hadn't
      // committed yet). A fire-and-forget prepare()/acquire() issued in that
      // window would hit the never-started candidate and reject with a
      // spurious NotReadyError/TypeError instead of reaching the shared
      // store. The window is a same-commit timing artifact: this test
      // harness's act() fully flushes pending re-renders before `renderHook`
      // resolves, so the exact window can't be forced open from outside —
      // this instead asserts the invariant structurally (calling
      // acquire() on both hooks immediately after mount, across StrictMode
      // on/off) rather than reproducing the race itself.
      const { Fake } = buildAIFake({
        status: "available",
        buildInstance: () => buildInstance(),
      });
      vi.stubGlobal(NAMESPACE, Fake);

      for (const wrapper of [undefined, StrictMode]) {
        __resetForTests();
        const { result } = await renderHook(
          () => {
            const a = useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
              mode: "adopt-race",
            });
            const b = useLifecycle<TestOptions, TestInstance>(NAMESPACE, {
              mode: "adopt-race",
            });
            return { a, b };
          },
          wrapper ? { wrapper } : {},
        );

        // Fired immediately after mount settles — the earliest point from
        // which the (would-be) adoption-race window could be observed —
        // rather than after an extra `waitFor` lets a reconciliation
        // re-render flush first.
        const [acquiredA, acquiredB] = await Promise.all([
          result.current.a.acquire(),
          result.current.b.acquire(),
        ]);

        expect(acquiredA.instance).toBeDefined();
        expect(acquiredB.instance).toBeDefined();
        expect(result.current.a.status).toBe("ready");
        expect(result.current.b.status).toBe("ready");
      }
    });

    test("rapid sequential options changes never leave more than the committed key retained", async () => {
      const { Fake } = buildAIFake({
        status: "available",
        buildInstance: () => buildInstance(),
      });
      vi.stubGlobal(NAMESPACE, Fake);

      const { rerender } = await renderHook(
        (props: { mode: string } = { mode: "v0" }) =>
          useLifecycle<TestOptions, TestInstance>(NAMESPACE, props),
        { initialProps: { mode: "v0" } },
      );

      for (let i = 1; i <= 5; i++) {
        await rerender({ mode: `v${i}` });
        expect(__sizeForTests()).toBe(1);
      }
    });

    test("prepare()'s error retry restarts the store for every component sharing it", async () => {
      let shouldFail = true;
      const create = vi.fn(() =>
        shouldFail
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(buildInstance({ marker: "shared-retry" })),
      );
      vi.stubGlobal(NAMESPACE, {
        availability: vi.fn(() => Promise.resolve("available")),
        create,
      });

      const hookA = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "retry" }),
      );
      const hookB = await renderHook(() =>
        useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "retry" }),
      );
      await vi.waitFor(() => expect(hookA.result.current.status).toBe("error"));
      await vi.waitFor(() => expect(hookB.result.current.status).toBe("error"));

      shouldFail = false;
      setUserActivation(true);
      await hookA.result.current.prepare();

      expect(hookA.result.current.status).toBe("ready");
      expect(hookB.result.current.status).toBe("ready");
      expect(create).toHaveBeenCalledTimes(2);
    });
  });
});
