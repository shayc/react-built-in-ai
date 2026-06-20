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
import { renderHook } from "vitest-browser-react";
import {
  BuiltInAIError,
  MissingUserActivationError,
  NotReadyError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import { invalidateAvailability } from "../availability-store";
import { buildProgressKey, snapshotProgressFor } from "../progress-store";
import { makeAIFake } from "../testing/ai-namespace-fake";
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

  test("transitions idle → ready when availability is 'available'", async () => {
    const { Fake, create } = makeAIFake({
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
    expect(result.current.status).toBe("idle");
    expect(observed).not.toContain("downloading");

    resolveCreate(inst);
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(observed).not.toContain("downloading");
  });

  test("settles at unavailable and never calls create", async () => {
    const { Fake, create } = makeAIFake({
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
    const { Fake, create } = makeAIFake({
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

  test("settles in 'downloadable' when the browser is already downloading elsewhere", async () => {
    const { Fake, create } = makeAIFake({
      status: "downloading",
      buildInstance,
    });
    vi.stubGlobal(NAMESPACE, Fake);

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));
    expect(create).not.toHaveBeenCalled();
  });

  test("prepare() rejects with MissingUserActivationError when downloadable without activation", async () => {
    const { Fake } = makeAIFake({
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
    const { Fake, create } = makeAIFake({
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

  test("writes 0 to the shared progress store as soon as download starts", async () => {
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

    expect(snapshotProgressFor([NAMESPACE])).toBe(0);

    resolveCreate(buildInstance());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(snapshotProgressFor([NAMESPACE])).toBeNull();
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
    expect(result.current.progress).toBe(0);

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
    const { Fake } = makeAIFake({
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
    const { Fake, create } = makeAIFake({
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
    const { Fake } = makeAIFake({
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
    const { Fake } = makeAIFake({
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
    const { Fake } = makeAIFake({
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
    const { Fake } = makeAIFake({
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

  test("re-creates and destroys the previous instance when options change", async () => {
    const first = buildInstance({ marker: "one" });
    const second = buildInstance({ marker: "two" });
    const queue: TestInstance[] = [first, second];
    const { Fake, create } = makeAIFake({
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
    const { Fake, create } = makeAIFake({
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
    const { Fake, create } = makeAIFake({
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
    const { Fake, create } = makeAIFake({
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

  test("server-renders the idle snapshot instead of crashing on a missing getServerSnapshot", () => {
    function Probe(): string {
      const lifecycle = useLifecycle<TestOptions, TestInstance>(
        NAMESPACE,
        undefined,
      );
      return lifecycle.status;
    }

    expect(renderToString(createElement(Probe))).toBe("idle");
  });

  test("acquire() rejects with MissingUserActivationError when downloadable without activation", async () => {
    const { Fake } = makeAIFake({
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
    const { Fake, create, instances } = makeAIFake({
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
    const { Fake } = makeAIFake({
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
    const { Fake, create, instances } = makeAIFake({
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
    expect(result.current.status).toBe("idle");

    const pending = result.current.acquire();
    resolveCreate(inst);

    const acquired = await pending;
    expect(acquired.instance).toBe(inst);
    expect(result.current.status).toBe("ready");
  });

  test("two hook instances with different options track lifecycle independently", async () => {
    const { Fake, create, instances } = makeAIFake({
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

  test("a sibling's download completion converges a parked 'downloadable' instance to ready, with no gesture and no 'downloading' flash", async () => {
    let available = false;
    const createOptions: { monitor?: unknown }[] = [];
    const create = vi.fn((options: { monitor?: unknown }) => {
      createOptions.push(options);
      return Promise.resolve(buildInstance({ marker: "converged" }));
    });
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() =>
        Promise.resolve(available ? "available" : "downloadable"),
      ),
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
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    // A sibling instance (or an imperative create*()) finishes the device-wide
    // download. userActivation is never set, so convergence must be gesture-free.
    available = true;
    invalidateAvailability(NAMESPACE);

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledTimes(1);
    // willDownload=false on the converging instance: no monitor, no refetch.
    expect(createOptions[0].monitor).toBeUndefined();
    // Never flashed "downloading" on the way to ready.
    expect(observed).not.toContain("downloading");
    expect(result.current.error).toBeNull();
  });

  test("an invalidation for a different config key leaves a parked instance untouched", async () => {
    const availability = vi.fn(() => Promise.resolve("downloadable"));
    const create = vi.fn(() => Promise.resolve(buildInstance()));
    vi.stubGlobal(NAMESPACE, { availability, create });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));
    const probesAtMount = availability.mock.calls.length;

    // A different option set (different buildProgressKey) finished its download.
    // Availability is per-config, so this instance must not re-probe or converge.
    invalidateAvailability(buildProgressKey(NAMESPACE, { mode: "b" }));

    expect(availability).toHaveBeenCalledTimes(probesAtMount);
    expect(create).not.toHaveBeenCalled();
    expect(result.current.status).toBe("downloadable");
  });

  test("a background convergence whose create() fails stays parked at 'downloadable', never 'error'", async () => {
    let available = false;
    const create = vi.fn(() => Promise.reject(new Error("create boom")));
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() =>
        Promise.resolve(available ? "available" : "downloadable"),
      ),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    available = true;
    invalidateAvailability(NAMESPACE);

    // The re-probe finds "available" and attempts create(), which throws — but a
    // background failure must not clobber a healthy parked store into "error".
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.status).toBe("downloadable");
    expect(result.current.error).toBeNull();
  });

  test("acquire() during a background convergence joins it and resolves without a gesture", async () => {
    let available = false;
    let resolveCreate!: (value: TestInstance) => void;
    const inst = buildInstance({ marker: "join" });
    const create = vi.fn(
      () =>
        new Promise<TestInstance>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal(NAMESPACE, {
      availability: vi.fn(() =>
        Promise.resolve(available ? "available" : "downloadable"),
      ),
      create,
    });

    const { result } = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, undefined),
    );
    await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

    // A sibling completes → a silent background convergence is now in flight.
    available = true;
    invalidateAvailability(NAMESPACE);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    // A reactive acquire() (no user gesture) lands mid-convergence: it must join
    // the in-flight provision rather than throw MissingUserActivationError.
    const pending = result.current.acquire();
    resolveCreate(inst);

    const acquired = await pending;
    expect(acquired.instance).toBe(inst);
    expect(result.current.status).toBe("ready");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("a sibling hook's own download wakes a parked same-config instance end-to-end", async () => {
    let downloaded = false;
    const availability = vi.fn(() =>
      Promise.resolve(downloaded ? "available" : "downloadable"),
    );
    const create = vi.fn(() => {
      downloaded = true;
      return Promise.resolve(buildInstance({ marker: "shared-model" }));
    });
    vi.stubGlobal(NAMESPACE, { availability, create });

    // Two instances of the SAME config (same progress key) — e.g. a board-level
    // chip and a Settings panel — mounted independently.
    const board = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    );
    const settings = await renderHook(() =>
      useLifecycle<TestOptions, TestInstance>(NAMESPACE, { mode: "a" }),
    );
    await vi.waitFor(() =>
      expect(board.result.current.status).toBe("downloadable"),
    );
    await vi.waitFor(() =>
      expect(settings.result.current.status).toBe("downloadable"),
    );

    // The Settings panel performs the real download (with a gesture); its
    // create-instance completion publishes the availability invalidation.
    setUserActivation(true);
    await settings.result.current.prepare();
    expect(settings.result.current.status).toBe("ready");

    // The board chip — never touched, never given its own gesture — re-probes
    // and converges to ready on its own.
    await vi.waitFor(() => expect(board.result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledTimes(2);
  });
});
